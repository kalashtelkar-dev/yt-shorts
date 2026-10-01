import { describe, expect, it } from "vitest";
import { youtubeId, youtubeLinkProblem } from "./youtube";

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

  it("accepts YouTube video links for montages, but not Shorts or other sites", () => {
    expect(youtubeLinkProblem("https://www.youtube.com/watch?v=YE_qhfoJQUQ&t=1000s")).toBeNull();
    expect(youtubeLinkProblem("https://youtu.be/_q_DGT5qpSU?t=294")).toBeNull();
    expect(youtubeLinkProblem("https://m.youtube.com/watch?v=YE_qhfoJQUQ")).toBeNull();
    expect(youtubeLinkProblem("https://music.youtube.com/watch?v=nsXwi67WgOo")).toBeNull();
    expect(youtubeLinkProblem("https://www.youtube.com/shorts/p5CqaQa8de4")).toMatch(/Shorts/);
    expect(youtubeLinkProblem("https://m.youtube.com/shorts/p5CqaQa8de4?feature=share")).toMatch(/Shorts/);
    expect(youtubeLinkProblem("http://www.youtube.com/watch?v=YE_qhfoJQUQ")).toMatch(/Only YouTube/);
    expect(youtubeLinkProblem("https://vimeo.com/123456")).toMatch(/Only YouTube/);
    expect(youtubeLinkProblem("https://youtube.com.evil.example/watch?v=YE_qhfoJQUQ")).toMatch(/Only YouTube/);
    expect(youtubeLinkProblem("https://www.youtube.com/@somechannel")).toMatch(/doesn't point to a video/);
    expect(youtubeLinkProblem("https://www.youtube.com/playlist?list=PL123")).toMatch(/doesn't point to a video/);
    expect(youtubeLinkProblem("not a url")).toMatch(/YouTube video link/);
  });
});
