(function () {
  const api = QuizPop.api;
  const storage = QuizPop.storage;
  const quizEngine = QuizPop.quizEngine;
  const CATEGORIES = QuizPop.CATEGORIES;

  const emptyState = document.getElementById("empty-state");
  const quizBody = document.getElementById("quiz-body");
  const categoryBadge = document.getElementById("category-badge");
  const questionEl = document.getElementById("question");
  const optsEl = document.getElementById("options");
  const explainEl = document.getElementById("explanation");
  const nextBtn = document.getElementById("next-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const openOptionsFromEmpty = document.getElementById("open-options-from-empty");

  let bank = [];
  let current = null;

  settingsBtn.addEventListener("click", () => api.runtime.openOptionsPage());
  openOptionsFromEmpty.addEventListener("click", () => api.runtime.openOptionsPage());
  nextBtn.addEventListener("click", renderNextQuestion);

  function categoryLabel(id) {
    const cat = CATEGORIES.find((c) => c.id === id);
    return cat ? cat.label : id;
  }

  function renderStats(stats) {
    document.getElementById("stat-correct").textContent = stats.correctCount;
    document.getElementById("stat-incorrect").textContent = stats.incorrectCount;
    document.getElementById("stat-streak").textContent = stats.currentStreak;
  }

  function renderNextQuestion() {
    current = quizEngine.pickRandomQuestion(bank, current?.id);
    explainEl.hidden = true;
    nextBtn.hidden = true;
    optsEl.innerHTML = "";
    categoryBadge.textContent = categoryLabel(current.category);
    questionEl.textContent = current.question;

    current.options.forEach((optText, idx) => {
      const btn = document.createElement("button");
      btn.className = "opt";
      btn.type = "button";
      btn.textContent = optText;
      btn.addEventListener("click", () => onAnswer(idx, btn));
      optsEl.appendChild(btn);
    });
  }

  function onAnswer(idx, btn) {
    if (btn.disabled) return;
    const isCorrect = idx === current.correctAnswerIndex;
    btn.classList.add(isCorrect ? "correct" : "incorrect");
    if (!isCorrect) {
      optsEl.children[current.correctAnswerIndex].classList.add("correct");
    }
    Array.from(optsEl.children).forEach((b) => (b.disabled = true));

    if (!isCorrect && current.explanation) {
      explainEl.textContent = current.explanation;
      explainEl.hidden = false;
    }
    nextBtn.hidden = false;

    storage.recordAnswer(isCorrect).then(renderStats);
  }

  function init() {
    Promise.all([storage.getSettings(), storage.getStats()]).then(([settings, stats]) => {
      renderStats(stats);
      if (!settings.selectedCategories.length) {
        emptyState.hidden = false;
        quizBody.hidden = true;
        return;
      }
      emptyState.hidden = true;
      quizBody.hidden = false;
      quizEngine.loadQuestionBank(settings.selectedCategories).then((loaded) => {
        bank = loaded;
        if (!bank.length) {
          questionEl.textContent = "No questions available for the selected categories.";
          optsEl.innerHTML = "";
          return;
        }
        renderNextQuestion();
      });
    });
  }

  init();
})();
