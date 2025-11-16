Learning Extraction Schema
Final Schema Structure
typescriptinterface Learning {
// Core structure
title: string; // Scannable summary for browsing
context: string; // What started this exploration (trigger, source, or situation)
insight: string; // What you discovered or learned
why: string; // Your explanation of WHY this is true
implications: string; // When/how to apply this
tags: string[]; // For retrieval and connections

// Abstraction ladder
abstraction: {
concrete: string; // Specific instance
pattern: string; // Generalizable pattern
principle?: string; // Universal principle (optional)
};

// Honest depth check
understanding: {
confidence: 1-10; // How well you understand this
can_teach_it: boolean; // Could you explain it to someone else?
known_gaps?: string[]; // What you still don't understand
};

// Learning effort
effort: {
processing_time: '5min' | '30min' | '2hr' | 'days';
cognitive_load: 'easy' | 'moderate' | 'hard' | 'breakthrough';
};

// Emotional context
resonance: {
intensity: 1-10; // How much this hit you (1=barely registered, 10=changed everything)
valence: 'positive' | 'negative' | 'mixed'; // How it felt
};

// Learning type
learning_type?: 'principle' | 'method' | 'anti_pattern' | 'exception';

// Optional
source_credit?: string; // If insight came from someone else (e.g., "Tina Brown", "Prof. Smith")
}
Extraction Prompt
Extract learning moments from this conversation/content using the schema below. Be intellectually honest and critical in your assessment.
Core Fields (Required)
Context: What triggered this learning? Could be a problem encountered, source consumed, or situation that sparked insight.
Insight: The actual discovery or learning. Be specific and concrete. Include enough detail that you'll understand this in 6 months.
Why: Your explanation of WHY this is true. This is not just restating the insight - explain the underlying mechanism or reasoning. If you can't explain why, you don't understand it.
Implications: Concrete applications or behavior changes. Not vague "this is important" but specific "when I see X, I should do Y."
Abstraction Ladder
Build from specific to general:

Concrete: The specific instance or example
Pattern: The generalizable pattern (applies across similar situations)
Principle: Universal truth (optional - only if it truly applies broadly)

Don't force a principle if there isn't one. Better to stop at pattern than to make up fake depth.
Understanding Assessment (BE RUTHLESSLY HONEST)
Confidence (1-10):

1-3: I'm mostly guessing
4-6: I get the basics but missing nuance
7-8: Solid understanding with minor gaps
9-10: Deep, complete understanding

Can teach it: Would you be comfortable explaining this to a smart colleague? If you'd stumble or hand-wave, mark false.
Known gaps: What specifically don't you understand? Be precise. "How it scales" is better than "some details." Empty gaps with high confidence is lying to yourself.
Effort Tracking
Processing time: How long to reach this understanding? Not reading/listening time, but actual thinking/processing time.
Cognitive load:

Easy: Immediately clicked
Moderate: Required focus and thought
Hard: Struggled to understand
Breakthrough: Fundamentally changed your thinking

Emotional Resonance
Intensity (1-10): How much did this insight affect you?

1-3: Mild interest, routine learning
4-6: Notable realization, worth remembering
7-9: Significant insight, changed your approach
10: Paradigm shift, fundamentally altered worldview

Valence:

Positive: Exciting, satisfying, empowering discovery
Negative: Frustrating, humbling, or revealed a mistake
Mixed: Both enlightening and challenging

Learning Type (Optional)

Principle: General truth or pattern
Method: Way of doing something
Anti_pattern: What NOT to do (title should start with "DON'T:" or "Avoid:")
Exception: Where a usual pattern doesn't apply

Critical Standards
REJECT shallow insights like:

"X is important" without explaining why
Buzzword soup without concrete understanding
Feel-good revelations without actionable implications
Claims you can teach something you've never actually taught

For ANTI-PATTERNS: Frame as what goes wrong and why. Be specific about the negative consequences.
DEMAND evidence of real understanding:

Can you predict what happens if this WASN'T true?
Can you explain it to someone unfamiliar with the domain?
Can you generate novel examples beyond what you learned?
Do you know WHY or just WHAT?

If you find yourself writing vague principles like "systems thinking is valuable" or "context matters," you haven't found the insight yet. Keep digging.
Examples
json{
"title": "Request-scoped providers tank NestJS performance",
"context": "API responses degraded from 50ms to 500ms after adding request-scoped logging",
"insight": "Request-scoped providers force NestJS to recreate the entire dependency tree per request, not just the scoped provider. One request-scoped logger can cause 10x latency increase.",
"why": "NestJS can't know which dependencies are stateless, so it defensively recreates everything in the dependency chain when any provider is request-scoped to ensure isolation",
"implications": "Use AsyncLocalStorage for request context instead; Check DI scope before adding providers; Consider singleton services with context passed as parameters",
"tags": ["nestjs", "performance", "debugging"],
"abstraction": {
"concrete": "Our request-scoped logger caused API latency to jump from 50ms to 500ms",
"pattern": "Dependency injection scope cascades through the entire dependency tree",
"principle": "Isolation guarantees have multiplicative performance costs in hierarchical systems"
},
"understanding": {
"confidence": 8,
"can_teach_it": true,
"known_gaps": ["Not sure how other DI frameworks like Spring handle this"]
},
"effort": {
"processing_time": "2hr",
"cognitive_load": "hard"
},
"resonance": {
"intensity": 7,
"valence": "negative"
},
"learning_type": "anti_pattern"
}
json{
"title": "Late night coding ruins next morning's run",
"context": "Noticed inconsistent running performance despite consistent training over 3 weeks",
"insight": "Intense cognitive work past 10pm affects next-day running performance more than getting 1 hour less sleep. Mental fatigue carries over physically.",
"why": "The brain needs buffer time to shift from high cognitive load to rest state. Without this transition, stress hormones remain elevated overnight, impairing physical recovery even if sleep duration is adequate",
"implications": "Hard stop at 9pm before morning runs; Schedule intense thinking for mornings after rest days; Treat mental recovery as seriously as physical recovery",
"tags": ["running", "productivity", "recovery"],
"abstraction": {
"concrete": "Coding until 11pm led to 5:10/km pace vs 4:45/km after stopping at 9pm",
"pattern": "High cognitive load before sleep impairs next-day physical performance",
"principle": "Recovery requires transition periods between different types of exertion"
},
"understanding": {
"confidence": 7,
"can_teach_it": true,
"known_gaps": ["Don't know the exact biological mechanism", "Not sure if this applies to other types of mental work"]
},
"effort": {
"processing_time": "days",
"cognitive_load": "moderate"
},
"resonance": {
"intensity": 6,
"valence": "mixed"
},
"learning_type": "principle"
}
json{
"title": "Four Tet's floating feeling comes from polyrhythm",
"context": "Couldn't articulate why certain Four Tet tracks created a unique 'floating' sensation",
"insight": "That 'floaty' feeling comes from hi-hats in 3 against kicks in 4 - creates tension that resolves every 12 beats. It's rhythmic ambiguity, not the melody.",
"why": "Brain tries to lock onto a pattern for prediction but keeps getting gently disrupted, creating a pleasurable cognitive puzzle that engages attention without causing frustration",
"implications": "Explore more polyrhythmic artists (Floating Points, Karriem Riggins); Try subtle rhythmic displacement in own productions; Listen for this pattern in other genres",
"tags": ["music", "four-tet", "rhythm"],
"abstraction": {
"concrete": "Four Tet's 'Two Thousand and Seventeen' uses 3-against-4 polyrhythm",
"pattern": "Polyrhythmic patterns create sense of floating or suspension in music",
"principle": "Violated expectations at regular intervals create aesthetic pleasure"
},
"understanding": {
"confidence": 6,
"can_teach_it": false,
"known_gaps": ["Can't reliably identify polyrhythm by ear yet", "Don't understand music theory behind why 3-against-4 specifically works"]
},
"effort": {
"processing_time": "30min",
"cognitive_load": "moderate"
},
"resonance": {
"intensity": 5,
"valence": "positive"
},
"learning_type": "principle"
}
json{
"title": "Selectorate theory explains autocratic stability",
"context": "PoliSci lecture discussing why some dictatorships last decades while democracies seem unstable",
"insight": "Autocrats maintain power by keeping the 'selectorate' (those who choose leaders) small and the 'winning coalition' (essential supporters) even smaller. Small coalitions are cheaper to buy off with private goods than providing public goods for everyone.",
"why": "In a system with 10 essential supporters, giving each $1M costs $10M. Providing hospitals and schools for 10 million people costs billions. The math favors corruption when the winning coalition is small.",
"implications": "Explains why foreign aid often backfires (provides resources for private goods); Why oil states tend toward autocracy (resource wealth enables buying loyalty); Why expanding the franchise threatens autocrats",
"tags": ["political-science", "selectorate-theory", "governance"],
"abstraction": {
"concrete": "Saudi Arabia distributes oil wealth to ~5,000 princes to maintain loyalty",
"pattern": "Leaders optimize distribution of resources based on coalition size",
"principle": "Political survival depends on satisfying your minimum winning coalition, not the population"
},
"understanding": {
"confidence": 7,
"can_teach_it": true,
"known_gaps": ["How does this apply to hybrid regimes?", "What determines initial coalition size?"]
},
"effort": {
"processing_time": "30min",
"cognitive_load": "moderate"
},
"resonance": {
"intensity": 8,
"valence": "positive"
},
"learning_type": "principle",
"source_credit": "Bruce Bueno de Mesquita"
}
json{
"title": "Royal scandals follow predictable media cycles",
"context": "Tina Brown podcast explaining how she covered Diana vs how Meghan/Harry story unfolded",
"insight": "Royal scandals have three acts: 1) Initial sympathy for the outsider against the institution, 2) Media turns when the outsider seeks publicity while claiming to want privacy, 3) Institution wins by simply enduring while individual exhausts public goodwill.",
"why": "The monarchy's power comes from permanence and ritual, not individual personalities. When royals try to compete on celebrity terms, they lose because celebrities need constant novelty while the monarchy's strength is unchanging tradition.",
"implications": "Institutions beat individuals in long games; Never fight on your opponent's terrain; The contradiction of wanting privacy while seeking publicity always undermines credibility",
"tags": ["media", "monarchy", "scandal-dynamics", "institutional-power"],
"abstraction": {
"concrete": "Harry and Meghan's Netflix deal undermined their privacy complaints",
"pattern": "Claiming victimhood while monetizing that victimhood erodes public sympathy",
"principle": "Institutional legitimacy comes from consistency; individual legitimacy comes from authenticity"
},
"understanding": {
"confidence": 6,
"can_teach_it": false,
"known_gaps": ["Don't fully understand British class dynamics at play", "Missing historical context about previous royal scandals"]
},
"effort": {
"processing_time": "30min",
"cognitive_load": "easy"
},
"resonance": {
"intensity": 4,
"valence": "mixed"
},
"learning_type": "method",
"source_credit": "Tina Brown"
}
