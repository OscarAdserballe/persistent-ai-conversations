import { useState } from "react";
import { MarkdownView } from "../MarkdownView";

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

interface FlashcardProps {
  learning: Learning;
}

export function Flashcard({ learning }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);
  const [currentBlockIndex, setCurrentBlockIndex] = useState<number | null>(null);

  const showMainCard = currentBlockIndex === null;
  const currentBlock = currentBlockIndex !== null ? learning.blocks[currentBlockIndex] : null;

  const handleNext = () => {
    if (showMainCard && learning.blocks.length > 0) {
      setCurrentBlockIndex(0);
    } else if (currentBlockIndex !== null && currentBlockIndex < learning.blocks.length - 1) {
      setCurrentBlockIndex(currentBlockIndex + 1);
    } else {
      // Reset to main card for next learning
      setCurrentBlockIndex(null);
    }
    setFlipped(false);
  };

  const getBlockTypeLabel = (type: string) => {
    switch (type) {
      case "qa": return "Q&A";
      case "why": return "Why?";
      case "contrast": return "Compare";
      default: return type;
    }
  };

  return (
    <div className="flashcard-container">
      <div className="flashcard-progress">
        {showMainCard ? (
          <span>Main Card</span>
        ) : (
          <span>Block {(currentBlockIndex ?? 0) + 1} of {learning.blocks.length}</span>
        )}
      </div>

      <div
        className={`flashcard ${flipped ? "flipped" : ""}`}
        onClick={() => setFlipped(!flipped)}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front">
            <div className="flashcard-tags">
              <span className="tag">{learning.sourceType}</span>
              {currentBlock && (
                <span className="tag">{getBlockTypeLabel(currentBlock.blockType)}</span>
              )}
            </div>

            <h3>{learning.title}</h3>

            <div className="flashcard-content">
              {showMainCard ? (
                <div className="context-section">
                  <strong>Problem Space:</strong>
                  <MarkdownView content={learning.problemSpace} />
                </div>
              ) : currentBlock && (
                <div className="context-section">
                  <strong>Question:</strong>
                  <MarkdownView content={currentBlock.question} />
                </div>
              )}
            </div>

            <div className="flashcard-hint">Click to reveal answer</div>
          </div>

          <div className="flashcard-back">
            <div className="flashcard-tags">
              <span className="tag">{learning.sourceType}</span>
              {currentBlock && (
                <span className="tag">{getBlockTypeLabel(currentBlock.blockType)}</span>
              )}
            </div>

            <h3>{learning.title}</h3>

            <div className="flashcard-content">
              {showMainCard ? (
                <>
                  <div className="answer-section">
                    <strong>Insight:</strong>
                    <MarkdownView content={learning.insight} />
                  </div>
                  {learning.blocks.length > 0 && (
                    <div className="answer-section">
                      <em>{learning.blocks.length} Q&A blocks available</em>
                    </div>
                  )}
                </>
              ) : currentBlock && (
                <div className="answer-section">
                  <strong>Answer:</strong>
                  <MarkdownView content={currentBlock.answer} />
                </div>
              )}
            </div>

            <div className="flashcard-hint" onClick={(e) => { e.stopPropagation(); handleNext(); }}>
              {showMainCard && learning.blocks.length > 0
                ? "Click here for Q&A blocks →"
                : currentBlockIndex !== null && currentBlockIndex < learning.blocks.length - 1
                  ? "Next block →"
                  : "Done with this card"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
