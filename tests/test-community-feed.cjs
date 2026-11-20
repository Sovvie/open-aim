// Community Workshop catalog answers (app/community-feed.js): the "offline" flag the lobby uses to say the
// workshop service could not be reached, instead of "Nothing here yet".
const assert = require("assert");
const feed = require("../app/community-feed.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; };

const item = { shareCode: "0123456789abcdef", name: "Long drill", createTime: "2026-11-01T10:00:00Z",
  facts: { bots: 3, duration: 60, scoring: "clicking", weapon: "vandal" }, likeCount: 2, weekLikeCount: 1 };

test("an unreachable service gives offline answers", () => {
  const empty = Object.assign([], { offline: true });
  assert.strictEqual(feed.home(empty).data.offline, true);
  assert.strictEqual(feed.page(empty, new URLSearchParams()).data.offline, true);
  assert.strictEqual(feed.page(empty, new URLSearchParams()).data.total, 0);
});

test("a reachable but empty catalog is not offline", () => {
  assert.strictEqual(feed.home([]).data.offline, false);
  assert.strictEqual(feed.page([], new URLSearchParams()).data.offline, false);
});

test("a normal catalog keeps its cards and is not offline", () => {
  const cards = feed.catalog([{ item, scene: null }]);
  assert.strictEqual(cards.length, 1);
  const page = feed.page(cards, new URLSearchParams("pageNum=1&pageSize=24"));
  assert.strictEqual(page.data.offline, false);
  assert.strictEqual(page.data.list[0].title, "Long drill");
  assert.strictEqual(feed.home(cards).data.freshTotal, 1);
});

console.log(`community feed: ${passed} tests passed`);
