import { useState, useEffect } from "react";
import { LearningCard } from "./LearningCard";

interface Learning {
  learningId: string;
  title: string;
  context: string;
  insight: string;
  why: string;
  implications: string;
  tags: string[];
  abstraction: {
    concrete: string;
    pattern: string;
    principle?: string;
  };
  createdAt: string;
}

export function ReviewView() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLearnings();
  }, []);

  const fetchLearnings = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `http://localhost:3001/api/learnings?limit=20&offset=${offset}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      setLearnings((prev) => [...prev, ...data.learnings]);
      setHasMore(data.hasMore);
      setOffset((prev) => prev + 20);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="error">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  return (
    <div className="review-view">
      <h2>Your Learning Timeline</h2>
      <p className="timeline-description">
        {learnings.length > 0
          ? `Showing ${learnings.length} learnings`
          : "Loading..."}
      </p>

      <div className="timeline">
        {learnings.map((learning) => (
          <LearningCard key={learning.learningId} learning={learning} />
        ))}
      </div>

      {hasMore && (
        <button
          className="load-more"
          onClick={fetchLearnings}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load More"}
        </button>
      )}

      {!hasMore && learnings.length > 0 && (
        <p className="timeline-end">End of timeline</p>
      )}
    </div>
  );
}
