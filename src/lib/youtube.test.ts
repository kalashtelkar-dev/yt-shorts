import { describe, expect, it } from "vitest";
import { youtubeId } from "./youtube";

describe("youtubeId", () => {
  it("reads the id from the links users paste, and nothing else", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=YE_qhfoJQUQ&t=1000s&pp=0gcJCTIMAYcqIYzv")).toBe("YE_qhfoJQUQ");
    expect(youtubeId("https://www.youtube.com/watch?v=u449iWK9JgU&list=RDEMpQpJ9pkgRCbAL7qDzO5hjw&start_radio=1")).toBe("u449iWK9JgU");
    expect(youtubeId("https://youtu.be/_q_DGT5qpSU?t=294")).toBe("_q_DGT5qpSU");
    expect(youtubeId("https://m.youtube.com/shorts/p5CqaQa8de4")).toBe("p5CqaQa8de4");
    expect(youtubeId("https://music.youtube.com/watch?v=nsXwi67WgOo")).toBe("nsXwi67WgOo");
    expect(youtubeId("https://youtu.be/x")).toBeNull();
    expect(youtubeId("https://evil.example/watch?v=YE_qhfoJQUQ")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });
});
