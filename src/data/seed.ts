import type { Thread } from "../types";

const DAY = 86400000;

const REG_ANSWER = `### Trend Summary
The U.S. medical device regulatory affairs market is valued at **USD 2,257.7 million in 2026** and is estimated to reach **USD 4,637.4 million by 2033**, growing at a **CAGR of 10.8%** from 2026 to 2033. In 2024, FDA approval and clearance pathways were shaped by a significant quality-system overhaul, faster pathways for certain devices, new expectations for cybersecurity and artificial intelligence, and closer alignment of clinical evidence requirements with international standards. These developments affected both the documentation manufacturers needed to submit and the systems they must maintain after authorization. ([U.S. medical device regulatory affairs market](#))

### Market Size Cards
| Metric | 2026 | 2033 | CAGR 2026–2033 (%) |
|---|---|---|---|
| Market Size (USD Mn) | 2,257.7 | 4,637.4 | 10.8 |

### Key regulatory shifts affecting approvals
**1. Quality Management System Regulation (QMSR) finalized**

In February 2024, FDA issued its final rule replacing the Quality System Regulation (QSR) with the Quality Management System Regulation. The rule incorporates by reference ISO 13485:2016, the widely used international quality-management standard for medical device manufacturers. It takes effect on February 2, 2026, so it did not immediately change the approval pathway in 2024, but it established a transition period for companies to update quality systems, procedures, and inspection readiness.

The practical approval impact is broader than a change in terminology. A coherent quality system supports design controls, risk management, supplier oversight, corrective actions, and manufacturing consistency, all of which can affect FDA review and ongoing compliance. Manufacturers pursuing new clearances or approvals therefore had reason to prepare submissions and supporting records in ways that align with the forthcoming requirements, while avoiding gaps between their existing QSR processes and ISO-based practices.

**2. Breakthrough Devices Program continued to support expedited review**

The program kept offering prioritized interaction and review for devices that provide more effective treatment or diagnosis of life-threatening or irreversibly debilitating conditions, which shortened the path to market for qualifying technologies.

**3. Cybersecurity became a standing submission requirement**

Premarket submissions for "cyber devices" are expected to include a software bill of materials, a plan to monitor and address vulnerabilities, and evidence of secure design, so cybersecurity documentation is now part of the core review file rather than an add-on.

**4. Predetermined change control plans for AI-enabled devices**

FDA's final guidance on predetermined change control plans (PCCPs) for AI-enabled device software functions lets manufacturers describe planned model updates up front, so authorized changes can be made without a new submission for each one.`;

const REG_FOLLOWUP = `For a **510(k) submission**, three of these shifts matter most:

1. **Cybersecurity documentation**: if the device has software and can connect to a network, the review file needs the SBOM, vulnerability-management plan and secure-design evidence.
2. **QMSR readiness**: clearance is not delayed by the transition, but design-control and risk-management records should already map to ISO 13485:2016 terms.
3. **PCCPs** if the device includes an AI-enabled software function and you expect to retrain or update the model after clearance.

The Breakthrough Devices Program is rarely relevant for a typical 510(k).`;

function sample(id: string, title: string, ageDays: number): Thread {
  const ts = Date.now() - ageDays * DAY;
  return {
    id,
    title,
    createdAt: ts,
    updatedAt: ts,
    certified: true,
    jobIds: [],
    messages: [
      { id: `${id}-u`, role: "user", ts, text: title },
      {
        id: `${id}-a`,
        role: "assistant",
        ts: ts + 4000,
        text: "_History thread (sample). The answer content isn't loaded in this working model. Start a new chat to try the Report and Deck builders._",
      },
    ],
  };
}

export function seedThreads(): Thread[] {
  const ts = Date.now() - 2 * DAY;
  const reg: Thread = {
    id: "t-regulatory",
    title: "Regulatory shifts in US medical-device approvals (2024)",
    createdAt: ts,
    updatedAt: ts + 60000,
    certified: true,
    jobIds: [],
    messages: [
      { id: "r1", role: "user", ts, text: "Regulatory shifts in US medical-device approvals (2024)" },
      { id: "r2", role: "assistant", ts: ts + 5000, text: REG_ANSWER },
      { id: "r3", role: "user", ts: ts + 50000, text: "Which of these matter most for a 510(k) submission?" },
      { id: "r4", role: "assistant", ts: ts + 56000, text: REG_FOLLOWUP },
    ],
  };
  return [
    reg,
    sample("t-regions", "Which regions offer the strongest growth for blood bank serology?", 9),
    sample("t-pe-regional", "Polyethylene packaging market regional outlook", 11),
    sample("t-pe-size", "Polyethylene packaging market size", 12),
    sample("t-ds-growth", "Dietary Supplements growth rate by segment", 14),
    sample("t-drivers-1", "What are the key growth drivers in the dietary supplements market?", 16),
    sample("t-drivers-2", "What are the key growth drivers in the cybersecurity market?", 18),
    sample("t-cyber", "Which cybersecurity solutions categories grow fastest?", 20),
    sample("t-ds-size", "Dietary Supplements Market size", 24),
  ];
}
