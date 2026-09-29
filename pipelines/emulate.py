"""Local interpreter for the util nodes of an Engine X graph, used to check that two graph
versions build the same render command from the same inputs. Engine steps are seeded."""
import json, re, sys

class Fan(list):  # a list that makes single-value nodes run once per item
    pass

def jsnum(x):
    if isinstance(x, float) and x.is_integer(): return int(x)
    return x

def jstr(v):  # JS String(v) / template insertion
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): v = jsnum(v); return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, (dict, list)): return json.dumps(v, separators=(',', ':'), ensure_ascii=False)
    return "" if v is None else str(v)

def js_regex_sub(pattern, repl, text, glob, flags=0):
    """String.prototype.replace: $& the match, $$ a dollar, $n / $nn a group ($nn only when that group exists, else $n
    followed by a digit), an unmatched group is empty; backslashes are plain characters."""
    rx = re.compile(pattern, flags)
    def expand(m):
        out, i = [], 0
        while i < len(repl):
            if repl[i] == "$" and i + 1 < len(repl):
                nxt = repl[i + 1]
                if nxt == "$": out.append("$"); i += 2; continue
                if nxt == "&": out.append(m.group(0)); i += 2; continue
                if nxt.isdigit():
                    two = repl[i + 1:i + 3]
                    if len(two) == 2 and two.isdigit() and 1 <= int(two) <= rx.groups:
                        out.append(m.group(int(two)) or ""); i += 3; continue
                    if 1 <= int(nxt) <= rx.groups:
                        out.append(m.group(int(nxt)) or ""); i += 2; continue
            out.append(repl[i]); i += 1
        return "".join(out)
    return rx.sub(expand, text, count=0 if glob else 1)

def num(v):
    if isinstance(v, (int, float)): return v
    try: return json.loads(v) if isinstance(v, str) else v
    except Exception: return v

def filt(items, p, compare_to):
    path, op = p.get("path", ""), p.get("op", "equals")
    cmp = compare_to if compare_to is not None else p.get("compareTo")
    out = []
    for it in items:
        v = it.get(path) if path else it
        if op == "is-empty": ok = v in (None, "", [], {})
        elif op == "matches": ok = re.search(str(cmp), jstr(v)) is not None
        else:
            a, b = num(v), num(cmp)
            ok = {"equals": a == b, "not-equals": a != b, "greater": a > b, "greater-or-equal": a >= b,
                  "less": a < b, "less-or-equal": a <= b}[op]
        if ok != bool(p.get("invert", False)): out.append(it)
    return Fan(out)

def run(graph, seeds, target):
    nodes = {n['id']: n for n in graph['nodes']}
    ins = {}
    for e in graph['edges']:
        ins.setdefault(e['to']['node'], []).append((e['to']['port'], e['from']['node'], e['from']['port']))
    cache = {}
    def out(nid, port):
        if (nid, port) in seeds: return seeds[(nid, port)]
        if nid not in cache: cache[nid] = evaluate(nid)
        return cache[nid].get(port)
    def evaluate(nid):
        n = nodes[nid]; p = dict(n.get('params') or {}); op = n.get('operation')
        if n.get('kind') == 'input': raise KeyError(f"input {nid} ({n.get('name')}) not seeded")
        ports = {}
        for port, f, fp in ins.get(nid, []):
            ports.setdefault(port, []).append(out(f, fp))
        one = {k: v[0] for k, v in ports.items()}
        LISTP = {"json-filter": "value", "json-aggregate": "value", "json-map": "value", "join": "value", "pick": "list", "json-unique": "value"}
        fan = [k for k, v in one.items() if isinstance(v, Fan) and LISTP.get(op) != k and k != "compareTo"]
        if len(fan) > 1: raise ValueError(f"{nid}: fan out twice {fan}")
        if fan:
            k = fan[0]; res = Fan()
            outs = {}
            for item in one[k]:
                r = apply(op, p, {**one, k: item}, nid)
                for pk, pv in r.items(): outs.setdefault(pk, Fan()).append(pv)
            return outs
        return apply(op, p, one, nid)
    def apply(op, p, v, nid):
        if op == "number": return {"value": p["value"]}
        if op == "text": return {"value": p["value"]}
        if op == "json-path":
            val = v["value"]; val = json.loads(val) if isinstance(val, str) else val
            got = val.get(p["path"]) if isinstance(val, dict) else None
            return {"value": got if got is not None else json.loads(p.get("fallback", "null"))}
        if op == "json-filter":
            r = filt(list(v["value"]), p, v.get("compareTo")); return {"items": r, "count": len(r)}
        if op == "json-map":
            return {"items": Fan(it.get(p["path"]) for it in v["value"] if not (p.get("dropEmpty") and it.get(p["path"]) in (None, "")))}
        if op == "json-pick":
            keys = [k.strip() for k in p["keys"].split(",")]
            return {"value": {k: v["value"][k] for k in keys if k in v["value"]}}  # order of the keys given
        if op == "json-stringify": return {"value": jstr(v["value"])}
        if op == "json-unique":
            seen, keep = set(), []
            for it in list(v["value"]):
                key = jstr(it.get(p["path"]) if p.get("path") else it)
                if key not in seen: seen.add(key); keep.append(it)
            return {"items": Fan(keep), "removed": len(list(v["value"])) - len(keep)}
        if op == "json-aggregate":
            if p.get("op") == "count": return {"value": len(list(v["value"]))}
            xs = [num(it.get(p["path"])) if p.get("path") else num(it) for it in v["value"]]
            return {"value": {"sum": sum(xs), "count": len(xs), "min": min(xs, default=0), "max": max(xs, default=0)}[p.get("op", "sum")]}
        if op == "join": return {"value": p.get("separator", "").join(jstr(x) for x in v["value"])}
        if op == "template":
            t = p["template"]
            for k, val in v.items(): t = t.replace("{{" + k + "}}", jstr(val))
            return {"value": t}
        if op == "regex":
            f = p.get("flags", "")
            return {"text": js_regex_sub(jstr(v.get("pattern", p.get("pattern"))), jstr(v.get("replace", p.get("replace", ""))), jstr(v["text"]), "g" in f, re.I if "i" in f else 0)}
        if op == "replace":
            return {"value": jstr(v["text"]).replace(p["find"], jstr(v.get("replace", p.get("replace", ""))))}
        if op == "math":
            a, b = num(v.get("a")), num(v.get("b"))
            r = {"add": lambda: a + b, "subtract": lambda: a - b, "multiply": lambda: a * b, "divide": lambda: a / b,
                 "min": lambda: min(a, b), "max": lambda: max(a, b)}[p["op"]]()
            return {"value": jsnum(r)}
        if op == "compare":
            a, b = num(v["a"]), num(v["b"])
            return {"result": {"greater": a > b, "less": a < b, "equals": a == b}[p["op"]]}
        if op == "gate": return {"value": v["value"] if v["when"] else None}
        if op == "merge": return {"value": next((x for x in v.values() if x is not None), None)}
        if op == "json-parse": return {"value": json.loads(v["text"])}
        if op == "length": return {"value": len(v["value"])}
        if op == "pick": return {"value": list(v["list"])[p.get("index", 0)], "count": len(v["list"])}
        raise NotImplementedError(f"{nid}: {op}")
    return out(*target)
