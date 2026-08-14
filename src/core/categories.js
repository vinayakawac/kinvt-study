// Registry of available question-bank categories. Add a new exam category by
// adding one entry here and one matching JSON file in src/data/ — no other
// code needs to change.
(function (global) {
  global.QuizPop = global.QuizPop || {};
  global.QuizPop.CATEGORIES = [
    { id: "general-knowledge", label: "General Knowledge", file: "data/general-knowledge.json" },
    { id: "upsc", label: "UPSC (Civil Services Prelims)", file: "data/upsc.json" },
    { id: "kpsc-kas", label: "KPSC / KAS (Karnataka)", file: "data/kpsc-kas.json" },
  ];
})(typeof self !== "undefined" ? self : globalThis);
