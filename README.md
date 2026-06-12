# GutPacer // Intestinal Pace Tuner & Bowel Tracker
### // 腸のペースを整える排便トラッカー // Module of ParkinSync

<p align="center">
  <img width="200" height="200" alt="GutPacer Logo" src="https://github.com/user-attachments/assets/69034e7e-76bf-441f-82c8-bffcbe87050f" />
</p>

---

## 🌟 Project Overview

**GutPacer** is a secure, serverless Web application module designed for caregivers and patients with Parkinson's Disease (PD). It enables efficient tracking of bowel movements and Movicol medication intake to collect critical data for analysis of medication effectiveness and symptom patterns.

### 🚫 The Personal Problem & Stakeholder (PM Focus)
The project was born out of a personal need. My father, who has Parkinson's Disease, suffers from severe constipation—a very common non-motor symptom of PD. His caregiver (helper) prepares his luggage for facility stays, but tracking his intestinal health has been error-prone. This module provides a single point of truth for caregivers (stakeholders) to manage and monitor his gut health.

### 🧠 Medical & Data Science Importance (MSCS Focus)
In Parkinson's Disease, **Constipation** is not just a daily discomfort. It significantly aggravates the absorption of L-dopa medication (such as EC-Dopal), leading to delayed gastric emptying. This results in debilitating "Delayed-on" or "Wearing-off" phenomena where medication effect is delayed or shortened. 

Finding the unique **"Pace" (Pattern)** of bowel movements in relation to medication is crucial for optimizing treatment and improving quality of life (QoL). This module defines and collects the essential data primitives (features) for future machine learning and pattern discovery.

---

## 📋 Functional Primitives (Key Features)

This module defines and tracks the following essential health primitives (data items) through a user-friendly interface. All data entries are designed for **Agile, high-velocity input (under 30 seconds)** by caregivers in the field.

### 📋 Bowel Tracker
Track Bowel Movements (BM).
* **Time:** Automatic timestamp primitives.
* **Amount:** Selectable (Small, Medium, Large).
* **Type:** Bristol Stool Chart based options (Lumpy, Sausage-like, Mushy, etc.).

### 💊 Medication Tracker
Track Movicol intake.
* **Movicol (1日3回):** Checkboxes for morning, noon, evening intake.
* *(Future roadmap primitives: L-dopa intake time and duration of effectiveness).*

---

## 📊 System Architecture & Tech Stack (MSCS Focus)

This module operates on a secure, highly available, and decoupled AWS Serverless infrastructure, designed for low-latency data entry and secure persistence.

```mermaid
graph LR
    User[User <br/> Caregiver / Son] -->|Access /gutpacer/| CF[AWS CloudFront]
    
    subgraph "Frontend Hosting"
        CF -->|Fetch Static Assets| S3[AWS S3 Bucket <br/> /gutpacer/ folder]
    end
    
    subgraph "Backend API (Module of ParkinSync)"
        CF -->|Proxy /api/gutpacer/*| API[AWS API Gateway]
        API --> Lambda[AWS Lambda <br/> Core Logic]
        Lambda --> DB[(AWS DynamoDB <br/> Bowel & Med Logs)]
    end
    
    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:white;
    classDef user fill:#ffffff,stroke:#333333,stroke-width:2px,color:#333333;
    classDef compute fill:#00A1C1,stroke:#232F3E,stroke-width:1px,color:white;
    
    class User user;
    class CF,S3,API,DB aws;
    class Lambda compute;
```

### 🛠️ Infrastructure Components:
*   **AWS CloudFront:** Global Content Delivery Network (CDN) ensuring immediate loading of the tracker interface for caregivers. Supports clean URL handling via CloudFront Functions.
*   **AWS S3:** Secure object storage hosting the static single-page application (SPA) frontend assets.
*   **AWS API Gateway:** Fully managed, secure entry point for routing backend API requests.
*   **AWS Lambda:** Serverless computing backend executing validation and data routing logic without provisioning servers.
*   **AWS DynamoDB:** NoSQL database optimized for high-velocity, structured health logs, laying the analytical foundation for future ML pattern discovery.
*   **Frontend Tech:** JavaScript, Tailwind CSS. Secure and lightweight by default.

---

## 🏁 Project Management Approach (PMP Focus)

This project adopts an Agile Development (Scrum) methodology. Milestones define distinct project phases. GitHub Issues are used for feature definition and tracking, emphasizing User Stories and Acceptance Criteria. This approach demonstrates PMP skills in defining scope, managing stakeholders (helper/son), and driving deliverables.

### 🚀 Future Roadmap
1.  **Phase 2: Data Persistence:** Sync live data payloads to DynamoDB via AWS Lambda.
2.  **Phase 3: AI / ML Pattern Discovery:** Synchronize with ParkinSync and utilize AWS SageMaker for pattern discovery (Delayed-on prediction) to provide actionable health insights.
3.  **Phase 4: Multi-user Real-time Sync:** Secure data access controls tailored for multiple caregivers.

> **Summary:** This project highlights the integration of PMP framework methodologies (Scope Definition, Stakeholder Management) alongside MSCS architecture implementation (Serverless Computing, Data Primitives Definition) to solve real-world, high-impact healthcare challenges.
