import { useState, useEffect } from "react";
import { Flashcard } from "./Flashcard";

interface Learning {
  learningId: string;
  title: string;
  context: string;
  insight: string;
  why: string;
  tags: string[];
  abstraction: {
    concrete: string;
    pattern: string;
    principle?: string;
  };
}

export function FlashcardsView() {
  const [learning, setLearning] = useState<Learning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRandomLearning = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:3001/api/learnings/random");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setLearning(data.learning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRandomLearning();
  }, []);

  if (error) {
    return (
      <div className="error">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (loading || !learning) {
    return <div className="flashcards-loading">Loading flashcard...</div>;
  }

  return (
    <div className="flashcards-view">
      <h2>Flashcard Practice</h2>
      <p className="flashcards-description">
        Try to recall the insight before clicking to reveal the answer
      </p>

      <Flashcard learning={learning} />

      <button className="next-card-button" onClick={fetchRandomLearning}>
        Next Card →
      </button>
    </div>
  );
}
