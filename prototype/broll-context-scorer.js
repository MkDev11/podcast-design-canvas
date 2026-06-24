"use strict";

(function exposeContextScorer(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrollContextScorer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createContextScorer() {
  const WEAK_THRESHOLD = 0.48;
  const STRONG_THRESHOLD = 0.72;
  const DOMAIN_TERMS = new Set([
    "launch",
    "product",
    "company",
    "customer",
    "audience",
    "platform",
    "workflow",
    "segment",
    "sponsor",
    "episode",
    "brand",
    "community",
    "revenue",
    "growth",
    "release",
  ]);
  const FILLER_WORDS = new Set([
    "about",
    "after",
    "again",
    "because",
    "before",
    "being",
    "could",
    "every",
    "really",
    "right",
    "something",
    "there",
    "these",
    "thing",
    "things",
    "those",
    "through",
    "where",
    "which",
    "would",
  ]);
  const REASON_COPY = {
    "speaker-context": {
      label: "Needs speaker context",
      guidance: "Confirm who this moment is about before adding a visual.",
    },
    "source-context": {
      label: "Needs a source to anchor it",
      guidance: "Add a public link, project page, or profile so the visual matches the reference.",
    },
    "topic-detail": {
      label: "Needs a clearer topic",
      guidance: "Add one more detail about the subject before this becomes b-roll.",
    },
    "reference-context": {
      label: "Needs reference context",
      guidance: "Confirm the reference in social context intake before it appears on screen.",
    },
  };

  function normalizeText(text) {
    return String(text || "")
      .replace(/[’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lowerWords(text) {
    return normalizeText(text)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9'-]*/g) || [];
  }

  function momentText(moment) {
    return normalizeText([moment?.transcript, moment?.reason, moment?.speaker].filter(Boolean).join(" "));
  }

  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  function uniqueMeaningfulWords(words) {
    return new Set(words.filter((word) => word.length > 4 && !FILLER_WORDS.has(word))).size;
  }

  function namedEntityMatches(text) {
    const normalized = normalizeText(text);
    const matches = normalized.match(/\b[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)+\b|\b[A-Z]{2,}\b|@[A-Za-z0-9_]+/g) || [];
    return matches.filter((match) => !/^(I|The|This|That|And|But|Host|Guest)$/.test(match));
  }

  function scoreNamedEntities(text) {
    const entityCount = namedEntityMatches(text).length;
    const hasUrl = /https?:\/\/|www\.|\.com\b|\.ai\b|\.fm\b/i.test(text);
    const hasHandle = /@[A-Za-z0-9_]+/.test(text);
    return clamp(entityCount * 0.28 + (hasUrl ? 0.22 : 0) + (hasHandle ? 0.16 : 0));
  }

  function scoreTopicSpecificity(text) {
    const words = lowerWords(text);
    if (!words.length) {
      return 0;
    }
    const meaningful = uniqueMeaningfulWords(words);
    const domainHits = words.filter((word) => DOMAIN_TERMS.has(word)).length;
    const hasMetric = /\b\d+(?:[.,]\d+)?%?\b|\b(first|second|third|quarter|million|thousand)\b/i.test(text);
    const density = meaningful / Math.max(words.length, 1);
    return clamp(density * 0.55 + domainHits * 0.12 + (hasMetric ? 0.22 : 0));
  }

  function scoreSpeakerReferences(text, approvedSpeakers = []) {
    const normalized = normalizeText(text).toLowerCase();
    const speakers = approvedSpeakers
      .map((speaker) => normalizeText(speaker).toLowerCase())
      .filter(Boolean);
    if (!speakers.length) {
      return 0.35;
    }
    const hits = speakers.filter((speaker) => normalized.includes(speaker)).length;
    return clamp(hits / Math.min(speakers.length, 2));
  }

  function contextStrength(score) {
    if (score < WEAK_THRESHOLD) {
      return "weak";
    }
    if (score >= STRONG_THRESHOLD) {
      return "strong";
    }
    return "medium";
  }

  function weakestReason(signals) {
    if (signals.speakerReference < 0.35) {
      return "speaker-context";
    }
    if (signals.namedEntity < 0.36) {
      return "source-context";
    }
    if (signals.topicSpecificity < 0.42) {
      return "topic-detail";
    }
    return "reference-context";
  }

  function scoreMoment(moment, options = {}) {
    const text = momentText(moment);
    const signals = {
      namedEntity: scoreNamedEntities(text),
      topicSpecificity: scoreTopicSpecificity(text),
      speakerReference: scoreSpeakerReferences(text, options.approvedSpeakers || []),
    };
    const score = clamp(
      signals.namedEntity * 0.32 +
      signals.topicSpecificity * 0.38 +
      signals.speakerReference * 0.3,
    );
    const reasonCode = weakestReason(signals);
    const copy = REASON_COPY[reasonCode];

    return {
      score,
      strength: contextStrength(score),
      needsReview: score < WEAK_THRESHOLD,
      reasonCode,
      reasonLabel: copy.label,
      guidance: copy.guidance,
      signals,
    };
  }

  function isVisibleDecision(moment) {
    return moment?.decision === "approved" || moment?.decision === "adjusted" || moment?.decision === "suggested";
  }

  function detectTitleRepeats(moments) {
    return moments.map((moment, index) => {
      if (index === 0 || moment?.type !== "title" || !isVisibleDecision(moment)) {
        return false;
      }
      const previous = moments[index - 1];
      return previous?.type === "title" && isVisibleDecision(previous);
    });
  }

  function buildIntakePayload(moment, analysis) {
    return {
      from: "broll",
      moment: normalizeText(moment?.reason),
      at: normalizeText(moment?.at),
      reason: analysis?.reasonLabel || REASON_COPY["reference-context"].label,
      reasonCode: analysis?.reasonCode || "reference-context",
    };
  }

  function encodeIntakeQuery(payload) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload || {})) {
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function parseIntakeQuery(search) {
    const query = String(search || "").replace(/^\?/, "");
    if (!query) {
      return null;
    }
    const params = new URLSearchParams(query);
    if (params.get("from") !== "broll") {
      return null;
    }
    return {
      from: "broll",
      moment: normalizeText(params.get("moment")),
      at: normalizeText(params.get("at")),
      reason: normalizeText(params.get("reason")),
      reasonCode: normalizeText(params.get("reasonCode")),
    };
  }

  return {
    WEAK_THRESHOLD,
    STRONG_THRESHOLD,
    buildIntakePayload,
    detectTitleRepeats,
    encodeIntakeQuery,
    namedEntityMatches,
    parseIntakeQuery,
    scoreMoment,
    scoreNamedEntities,
    scoreSpeakerReferences,
    scoreTopicSpecificity,
  };
});
