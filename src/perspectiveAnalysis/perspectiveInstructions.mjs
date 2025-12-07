export const PERSPECTIVE_INSTRUCTIONS = {
  prosecutor: {
    role: 'Prosecutor/Complainant Counsel',
    focus: "Party A's case against Party B. Violations by Party B. Harm to Party A.",
    planRole: 'Prosecutor/Complainant Legal Planner',
    planFocus: "Legal violations by Party B. Party B's liability. Remedies for Party A.",
  },
  defense: {
    role: 'Defense Counsel',
    focus: "Party B's defense against Party A. Party B's rights. Weaknesses in Party A's case.",
    planRole: 'Defense Legal Planner',
    planFocus:
      "Legal defenses for Party B. Party B's rights protection. Burden of proof on Party A.",
  },
  judge: {
    role: 'Judge',
    focus: 'Legal questions between Party A and Party B. Evidence from both sides. Applicable law.',
    planRole: 'Judicial Research Planner',
    planFocus:
      'Legal precedent for this dispute type. Applicable statutes. Procedural requirements. Constitutional analysis.',
  },
};
