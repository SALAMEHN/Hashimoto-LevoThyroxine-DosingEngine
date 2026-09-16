# Hashimoto & Hypothyroidism Levothyroxine Dosing Engine

A precision pharmacokinetic/pharmacodynamic (PK/PD) dosing calculator and longitudinal titration tracking dashboard for Levothyroxine (LT4) replacement therapy. Designed for patients with primary hypothyroidism, Hashimoto's Thyroiditis, and post-thyroidectomy conditions.

---

## 🔬 Overview & Clinical Rationale

Standard empirical weight-based guidelines (e.g., $1.6\ \mu\text{g/kg/day}$) frequently fail due to high inter-individual variability in gut absorption, residual endogenous thyroid function, thyroid hormone clearance rates, and variations in body composition (adipose tissue vs. lean mass).

This platform bridges clinical endocrinology and computational pharmacometrics by combining:
1. **A Steady-State 1-Compartment PK Model** driven by Lean Body Mass (LBM) and physiological clearance.
2. **A Sigmoidal Pituitary-Thyroid PD Model** (Hill equation) representing negative feedback inhibition.
3. **Bayesian Maximum A Posteriori (MAP) Fitting** with regularized gradient descent that learns individual patient parameters over serial blood tests.
4. **Exact Closed-Form Dose Inversion** calculating the quantized daily dose ($\mu\text{g/day}$) required to reach a clinician's specific target TSH.

---

## 📐 Mathematical & Pharmacological Engine

### 1. Steady-State Pharmacokinetics (PK)
At steady state ($\approx 6$ weeks of stable dosing, representing $\sim 5 \times$ the 7-day elimination half-life of T4), serum free thyroxine ($\text{fT4}$) is governed by:

$$\text{fT4}_{ss}(D) = \alpha \cdot \frac{\eta \cdot D + S_{end}}{k_e \cdot V_d}$$

Where:
- $D$: Daily oral levothyroxine dose ($\mu\text{g/day}$).
- $\eta$: Patient-specific gut bioavailability / absorption fraction ($\text{prior} = 0.80$, physiologically bounded to $[0.05, 1.00]$).
- $S_{end}$: Endogenous T4 synthesis capacity ($\mu\text{g/day}$), conditioned on native gland anatomy:
  - **Intact gland (Hashimoto's)**: Prior $\approx 40\ \mu\text{g/day}$
  - **Partial resection / lobectomy**: Prior $\approx 15\ \mu\text{g/day}$
  - **Total thyroidectomy**: Prior $= 0\ \mu\text{g/day}$
- $k_e$: First-order elimination rate constant ($\text{day}^{-1}$, $\text{prior} \approx 0.10\ \text{day}^{-1}$ corresponding to $T_{1/2} = \frac{\ln 2}{k_e} \approx 7\ \text{days}$).
- $V_d$: Apparent volume of distribution derived from Lean Body Mass:
  $$V_d = 0.16\ \text{L/kg} \times W_{LBM}$$
- $\alpha \approx 0.014$: Analytical unit conversion factor accounting for the mass-to-concentration conversion ($1\ \mu\text{g/L} = 100\ \text{ng/dL}$) scaled by the physiological free fraction of plasma T4 ($\sim 0.02 - 0.03\%$).
- $\text{CL} = k_e \cdot V_d$: Physiological metabolic clearance rate ($\approx 0.8 - 1.5\ \text{L/day}$).

### 2. Pharmacodynamics (PD): Pituitary TSH Secretion
Pituitary suppression follows a sigmoidal Hill/Michaelis-Menten feedback curve:

$$\text{TSH}_{ss}(\text{fT4}) = \frac{\text{TSH}_{max}}{1 + \left(\frac{\text{fT4}}{EC_{50}}\right)^\gamma}$$

- $\text{TSH}_{max} = 100.0\ \text{mIU/L}$: Maximum pituitary secretory capacity.
- $EC_{50} = 0.32\ \text{ng/dL}$: Half-maximal suppression threshold (in the hypothyroid range).
- $\gamma = 3.0$: Hill slope coefficient capturing the non-linear sensitivity of pituitary thyrotropes.

### 3. Bayesian MAP Parameter Identification
Given $N$ historical titration cycles $[(D_1, y_1), \dots, (D_N, y_N)]$ where $y_i = [\text{TSH}_i, \text{fT4}_i]$, the parameter vector $\theta = [\eta, S_{end}, k_e]$ is identified by minimizing the objective cost function $J(\theta)$:

$$J(\theta) = \sum_{i=1}^{N} \left[ w_{\text{TSH}} \left(\text{TSH}_i - \widehat{\text{TSH}}_i\right)^2 + w_{\text{fT4}} \left(\text{fT4}_i - \widehat{\text{fT4}}_i\right)^2 \right] + \lambda \sum_{j} \frac{(\theta_j - \theta_{\text{prior}, j})^2}{\sigma_j^2}$$

- Residual weights: $w_{\text{TSH}} = 1.0$, $w_{\text{fT4}} = 10.0$ (reflecting smaller residual magnitudes of $\text{ng/dL}$).
- Regularization parameters: $\sigma_\eta = 0.3$, $\sigma_{S_{end}} = 40.0$, $\sigma_{k_e} = 0.15$.
- Minimization via gradient descent using analytical partial derivatives derived with the chain rule.

### 4. Optimal Dose Inversion
With the updated parameter vector $\hat{\theta}$, the target free T4 concentration is inverted from the clinician's target TSH:

$$\text{fT4}_{target} = EC_{50} \cdot \left(\frac{\text{TSH}_{max}}{\text{TSH}_{target}} - 1\right)^{1/\gamma}$$

The exact continuous required dose $D^*$ is solved algebraically:

$$D^* = \frac{\frac{\text{fT4}_{target} \cdot k_e \cdot V_d}{\alpha} - S_{end}}{\eta}$$

The continuous solution is quantized to commercially available pharmacy tablet steps ($12.5\ \mu\text{g}$) and clamped within safe clinical guardrails ($25 - 300\ \mu\text{g/day}$).

---

## ✨ Features

- **👤 Comprehensive Patient Profile**:
  - Baseline demographics, biological sex, birth year, height.
  - Granular thyroid status (`intact`, `partial_resection`, `total_thyroidectomy`).
  - Hashimoto's diagnosis and cardiac risk flags.
  - Customizable target TSH level (e.g., $1.0 - 2.0\ \mu\text{IU/mL}$).

- **📋 Longitudinal Lab History & Body Composition**:
  - Track serial blood tests: Date, Weight, TSH, Free T4, Free T3, Anti-TPO, and Anti-Tg.
  - Lean Body Mass (LBM) estimation via:
    - Direct DEXA scan input.
    - Anthropometric waist-to-height formula (James/Hume).
    - Clinical fallback ratio ($75\%$ total body weight, bounded $[40\%, 95\%]$).
  - Strict **one-entry-per-day** clinical constraint to eliminate conflicting steady-state assumptions.

- **⚡ Synchronized 1-to-1 Optimization Pipeline**:
  - Each lab record corresponds to exactly one computational titration run.
  - Editing or deleting a lab log automatically updates or cleans up its associated calculation run, preventing orphan states.

- **🧮 Precision Titration Calculator**:
  - Evaluates all historical cycles simultaneously.
  - Outputs recommended daily dose, estimated LBM, physiological clearance rate ($CL$ in L/day), predicted steady-state TSH, and objective fit value.

- **📖 Built-in "How It Works" Technical Manual**:
  - Interactive, in-app documentation tab with complete mathematical equations, parameter priors, gradient descent mechanics, and clinical safety limitations.

- **🔒 Enterprise Security & Multi-Tenancy**:
  - Built on Supabase Authentication and PostgreSQL with Row Level Security (RLS) policies ensuring users can only read and modify their own medical records.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
- **UI & Logic**: [React 19](https://react.dev/), [TypeScript 5](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL + Auth + Row Level Security)

---

## 📁 Repository Structure

```
├── app/
│   ├── dashboard/
│   │   ├── DashboardClient.tsx    # Interactive multi-tab clinical dashboard
│   │   └── page.tsx               # Server-side auth check & dashboard entry
│   ├── login/
│   │   └── page.tsx               # Authentication page (Sign in / Sign up)
│   ├── globals.css                # Tailwind CSS v4 styling rules
│   ├── layout.tsx                 # Root application layout
│   └── page.tsx                   # Root redirect logic
├── lib/
│   ├── engine/
│   │   ├── solver.ts              # Analytical PK/PD solver & Bayesian MAP optimizer
│   │   └── types.ts               # Core domain models & TypeScript schemas
│   └── supabase/
│       ├── client.ts              # Browser Supabase client
│       └── server.ts              # Server-side SSR Supabase client
├── supabase/
│   └── migrations/
│       └── 01_initial_schema.sql  # Database tables (profiles, lab_logs) & RLS policies
├── package.json                   # Project dependencies and scripts
└── tsconfig.json                  # TypeScript configuration
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.17+ or v20+ recommended)
- A [Supabase](https://supabase.com/) project

### 1. Clone the Repository
```bash
git clone https://github.com/SALAMEHN/Hashimoto-LevoThyroxine-DosingEngine.git
cd Hashimoto-LevoThyroxine-DosingEngine
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Database Schema
In your Supabase project dashboard, navigate to the **SQL Editor** and run the contents of:
[`supabase/migrations/01_initial_schema.sql`](file:///supabase/migrations/01_initial_schema.sql)

This creates:
- `public.profiles`: Stores patient clinical profile and thyroid status.
- `public.lab_logs`: Stores serial laboratory test observations and doses.
- Row Level Security (RLS) policies linked to `auth.users`.

### 4. Set Up Environment Variables
Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

### 5. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚠️ Clinical Disclaimer

> **IMPORTANT**: This software is intended strictly for educational, informational, and pharmacometric research purposes. It is **not** a certified medical device and does not constitute medical advice or diagnostic software.
> 
> Levothyroxine dosing in clinical practice must account for individual gastrointestinal absorption disorders (e.g., Celiac disease, atrophic gastritis), concurrent medications (e.g., calcium, iron, PPIs), pregnancy, cardiac disease, and physician assessment. Always consult a qualified endocrinologist or licensed medical professional before adjusting any prescription medication.
