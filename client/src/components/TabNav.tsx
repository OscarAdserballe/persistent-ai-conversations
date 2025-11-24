interface TabNavProps {
  activeTab: "explain" | "review" | "flashcards";
  onChange: (tab: "explain" | "review" | "flashcards") => void;
}

export function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <nav className="tab-nav">
      <button
        className={activeTab === "explain" ? "active" : ""}
        onClick={() => onChange("explain")}
      >
        🔮 Explain
      </button>
      <button
        className={activeTab === "review" ? "active" : ""}
        onClick={() => onChange("review")}
      >
        📚 Review
      </button>
      <button
        className={activeTab === "flashcards" ? "active" : ""}
        onClick={() => onChange("flashcards")}
      >
        🎴 Flashcards
      </button>
    </nav>
  );
}
