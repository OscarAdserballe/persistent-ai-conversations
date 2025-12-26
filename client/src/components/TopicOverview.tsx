import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Topic {
  topicId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  sourceText?: string;
}

interface TopicOverviewProps {
  topic: Topic | null;
  loading?: boolean;
}

export function TopicOverview({ topic, loading }: TopicOverviewProps) {
  const [showSourceText, setShowSourceText] = useState(false);

  if (loading) {
    return (
      <div className="topic-overview">
        <div className="overview-loading">Loading topic...</div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="topic-overview">
        <div className="overview-empty">
          <div className="empty-icon">📚</div>
          <h3>Select a topic</h3>
          <p>Choose a topic from the sidebar to see its summary and flashcards.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="topic-overview">
      <div className="overview-header">
        <h2 className="overview-title">{topic.title}</h2>
      </div>

      <div className="overview-section">
        <h3>Summary</h3>
        <p className="overview-summary">{topic.summary}</p>
      </div>

      <div className="overview-section">
        <h3>Key Points</h3>
        <ul className="overview-keypoints">
          {topic.keyPoints.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      </div>

      {topic.sourceText && (
        <div className="overview-section">
          <button
            className="source-toggle"
            onClick={() => setShowSourceText(!showSourceText)}
          >
            {showSourceText ? "▼" : "►"} Source Material
          </button>
          {showSourceText && (
            <div className="overview-source markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {topic.sourceText}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
