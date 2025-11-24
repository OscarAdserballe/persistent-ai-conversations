import { useState } from "react";
import "./App.css";
import { TabNav } from "./components/TabNav";
import { ExplainView } from "./components/ExplainView";
import { ReviewView } from "./components/ReviewView";
import { FlashcardsView } from "./components/FlashcardsView";

function App() {
  const [activeTab, setActiveTab] = useState<"explain" | "review" | "flashcards">("explain");

  return (
    <div className="container">
      <header>
        <h1>🔮 The Isomorphism Engine</h1>
        <p>
          {activeTab === "explain" && "Explain confusing concepts using your past learnings"}
          {activeTab === "review" && "Browse your learning timeline"}
          {activeTab === "flashcards" && "Practice active recall with flashcards"}
        </p>
      </header>

      <TabNav activeTab={activeTab} onChange={setActiveTab} />

      <main>
        {activeTab === "explain" && <ExplainView />}
        {activeTab === "review" && <ReviewView />}
        {activeTab === "flashcards" && <FlashcardsView />}
      </main>
    </div>
  );
}

export default App;
