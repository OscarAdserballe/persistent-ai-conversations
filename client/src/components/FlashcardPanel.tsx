import { useState } from "react";

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
}

interface FlashcardPanelProps {
  learning: Learning | null;
  currentIndex: number;
  totalCount: number;
  onNext: () => void;
  loading?: boolean;
}

type CardView = "main" | { blockIndex: number };

export function FlashcardPanel({
  learning,
  currentIndex,
  totalCount,
  onNext,
  loading,
}: FlashcardPanelProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [cardView, setCardView] = useState<CardView>("main");

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleNext = () => {
    // If we're on the main card and there are blocks, go to first block
    if (cardView === "main" && learning && learning.blocks.length > 0) {
      setCardView({ blockIndex: 0 });
      setIsFlipped(false);
    }
    // If we're on a block, go to next block or next learning
    else if (typeof cardView === "object" && learning) {
      const nextBlockIndex = cardView.blockIndex + 1;
      if (nextBlockIndex < learning.blocks.length) {
        setCardView({ blockIndex: nextBlockIndex });
        setIsFlipped(false);
      } else {
        // No more blocks, go to next learning
        setCardView("main");
        setIsFlipped(false);
        onNext();
      }
    }
    // Main card with no blocks, go to next learning
    else {
      setCardView("main");
      setIsFlipped(false);
      onNext();
    }
  };

  if (loading) {
    return (
      <div className="flashcard-panel">
        <div className="flashcard-loading">Loading flashcard...</div>
      </div>
    );
  }

  if (!learning) {
    return (
      <div className="flashcard-panel">
        <div className="flashcard-empty">
          <div className="empty-icon">🎴</div>
          <h3>No flashcards</h3>
          <p>Select a topic to see its flashcards.</p>
        </div>
      </div>
    );
  }

  // Determine current card content
  const isMainCard = cardView === "main";
  const currentBlock = typeof cardView === "object" ? learning.blocks[cardView.blockIndex] : null;

  // Calculate progress within this learning
  const totalCards = 1 + learning.blocks.length;
  const currentCard = isMainCard ? 1 : 2 + (typeof cardView === "object" ? cardView.blockIndex : 0);

  const getBlockTypeLabel = (type: string) => {
    switch (type) {
      case "qa": return "Q&A";
      case "why": return "Why?";
      case "contrast": return "Compare";
      default: return type;
    }
  };

  return (
    <div className="flashcard-panel">
      {/* Progress info */}
      <div className="flashcard-progress">
        <span className="progress-counter">
          {currentIndex + 1} / {totalCount} learnings
        </span>
        <span className="card-progress">
          Card {currentCard} / {totalCards}
        </span>
      </div>

      {/* Card title */}
      <div className="flashcard-header">
        <span className="learning-title">{learning.title}</span>
        {!isMainCard && currentBlock && (
          <span className="block-badge">{getBlockTypeLabel(currentBlock.blockType)}</span>
        )}
      </div>

      {/* Flip card */}
      <div
        className={`flashcard-flip-container ${isFlipped ? "flipped" : ""}`}
        onClick={handleFlip}
      >
        <div className="flashcard-flip-inner">
          {/* Front */}
          <div className="flashcard-front">
            <div className="card-label">
              {isMainCard ? "When does this matter?" : "Question"}
            </div>
            <div className="card-content">
              {isMainCard ? learning.problemSpace : currentBlock?.question}
            </div>
            <div className="card-hint">Click to flip</div>
          </div>

          {/* Back */}
          <div className="flashcard-back">
            <div className="card-label">
              {isMainCard ? "Insight" : "Answer"}
            </div>
            <div className="card-content">
              {isMainCard ? learning.insight : currentBlock?.answer}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flashcard-actions">
        <button className="btn btn-next" onClick={handleNext}>
          {currentCard < totalCards ? "Next Card" : "Next Learning"}
        </button>
      </div>
    </div>
  );
}
