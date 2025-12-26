import { useState, useEffect, useCallback } from "react";

interface ContentBlock {
  blockType: "qa" | "why" | "contrast";
  question: string;
  answer: string;
}

interface Learning {
  learningId: string;
  title: string;
  problemSpace: string;
  insight: string;
  blocks: ContentBlock[];
  sourceType: "conversation" | "topic";
  sourceId: string;
}

interface Topic {
  topicId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  sourcePassages?: string[];
  sourceText?: string;
}

type CardType = "main" | "block";

interface CurrentCard {
  type: CardType;
  blockIndex?: number;
}

export function FlashcardsView() {
  const [learning, setLearning] = useState<Learning | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [currentCard, setCurrentCard] = useState<CurrentCard>({ type: "main" });

  const fetchRandomLearning = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRevealed(false);
    setCurrentCard({ type: "main" });

    try {
      const response = await fetch("http://localhost:3001/api/learnings/random");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setLearning(data.learning);
      setTopic(data.topic); // May be null if learning is from a conversation
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRandomLearning();
  }, [fetchRandomLearning]);

  const handleReveal = () => {
    setRevealed(true);
  };

  const handleNextBlock = () => {
    if (!learning) return;

    setRevealed(false);

    if (currentCard.type === "main") {
      if (learning.blocks.length > 0) {
        setCurrentCard({ type: "block", blockIndex: 0 });
      } else {
        fetchRandomLearning();
      }
    } else if (currentCard.blockIndex !== undefined) {
      if (currentCard.blockIndex < learning.blocks.length - 1) {
        setCurrentCard({ type: "block", blockIndex: currentCard.blockIndex + 1 });
      } else {
        fetchRandomLearning();
      }
    }
  };

  const handleSkipToNext = () => {
    fetchRandomLearning();
  };

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={fetchRandomLearning}>Try Again</button>
      </div>
    );
  }

  if (loading || !learning) {
    return <div className="loading">Loading...</div>;
  }

  const isMainCard = currentCard.type === "main";
  const currentBlock = currentCard.blockIndex !== undefined
    ? learning.blocks[currentCard.blockIndex]
    : null;

  const totalCards = 1 + learning.blocks.length;
  const currentCardNumber = isMainCard ? 1 : 2 + (currentCard.blockIndex ?? 0);

  const getBlockTypeLabel = (type: string) => {
    switch (type) {
      case "qa": return "Q&A";
      case "why": return "Why?";
      case "contrast": return "Compare";
      default: return type;
    }
  };

  return (
    <div className="study-deck">
      {/* Topic Panel - Left Side */}
      {topic && (
        <div className="topic-panel">
          <h2 className="topic-title">{topic.title}</h2>
          <p className="topic-summary">{topic.summary}</p>

          <div className="topic-section">
            <h3>Key Points</h3>
            <ul className="key-points">
              {topic.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>

          {topic.sourceText && (
            <div className="topic-section">
              <h3>Source Material</h3>
              <div className="source-text">
                {topic.sourceText}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Flashcard Panel - Right Side */}
      <div className="flashcard-panel">
        {/* Progress bar */}
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(currentCardNumber / totalCards) * 100}%` }}
          />
        </div>

        <div className="card-info">
          <span className="card-counter">{currentCardNumber} / {totalCards}</span>
          <span className="card-title">{learning.title}</span>
        </div>

        {/* Card */}
        <div className="card">
          <div className="card-badge">
            {isMainCard ? (
              <span className="badge badge-main">Main Insight</span>
            ) : currentBlock && (
              <span className="badge badge-block">{getBlockTypeLabel(currentBlock.blockType)}</span>
            )}
          </div>

          <div className="card-question">
            {isMainCard ? (
              <>
                <h3>When does this matter?</h3>
                <p>{learning.problemSpace}</p>
              </>
            ) : currentBlock && (
              <>
                <h3>Question</h3>
                <p>{currentBlock.question}</p>
              </>
            )}
          </div>

          {revealed && (
            <div className="card-answer">
              <div className="answer-divider" />
              {isMainCard ? (
                <>
                  <h3>Insight</h3>
                  <p>{learning.insight}</p>
                </>
              ) : currentBlock && (
                <>
                  <h3>Answer</h3>
                  <p>{currentBlock.answer}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="actions">
          {!revealed ? (
            <button className="btn btn-primary btn-large" onClick={handleReveal}>
              Show Answer
            </button>
          ) : (
            <div className="rating-buttons">
              <button className="btn btn-next" onClick={handleNextBlock}>
                {currentCardNumber < totalCards ? "Next" : "New Card"}
              </button>
            </div>
          )}
        </div>

        {/* Skip button */}
        <button className="btn-skip" onClick={handleSkipToNext}>
          Skip to new learning
        </button>
      </div>
    </div>
  );
}
