import json
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langgraph.graph import StateGraph, START, END

from schemas import PipelineState
from llms import gemini_llm, groq_llm

# ==========================================
# 1. Real-time Ambiguity Detection Chain
# ==========================================

ambiguity_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an expert Requirements Engineer monitoring a live stakeholder meeting.
Analyze the latest transcript turn. Identify vague, incomplete, or untestable statements 
(e.g., 'ideally quick', 'solid projects', 'HR trusts it', 'MVP soon', 'avoid bias').

If ambiguous statements exist:
1. Extract the ambiguous phrases.
2. Formulate ONE direct, intelligent clarification question to elicit testable, unambiguous metrics.
3. Categorize the requirement dimension (Performance, Fairness, Functional Scope, Delivery Timeline, etc.).

Return ONLY valid JSON matching this schema:
{{
  "has_ambiguity": true/false,
  "ambiguous_phrases": ["..."],
  "clarification_question": "...",
  "category": "..."
}}"""),
    ("human", "Recent Conversation Context:\n{context}\n\nLatest Speaker Statement:\n{latest_statement}")
])

# Route this specific chain to Groq
ambiguity_chain = ambiguity_prompt | groq_llm | JsonOutputParser()

# ==========================================
# 2. LangGraph State & Synthesis Pipeline
# ==========================================

# Node 1: Baseline Extraction (Without Clarifications)
async def extract_baseline_requirements(state: PipelineState) -> dict:
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a Requirements Analyst. Extract Functional Requirements (FR) and 
categorized Non-Functional Requirements (NFR) strictly from the raw, unclarified transcript.
Do not infer details that were left vague.

Output JSON format:
{{
  "functional_requirements": ["FR1: ...", "FR2: ..."],
  "non_functional_requirements": {{
     "Performance": ["..."],
     "Fairness & Bias": ["..."],
     "Explainability": ["..."],
     "Reliability & Data": ["..."]
  }}
}}"""),
        ("human", "Raw Transcript:\n{transcript}")
    ])
    chain = prompt | gemini_llm | JsonOutputParser()
    res = await chain.ainvoke({"transcript": state["raw_transcript"]})
    return {
        "baseline_fr": res.get("functional_requirements", []),
        "baseline_nfr": res.get("non_functional_requirements", {})
    }

# Node 2: Refined Extraction (With Clarification Answers)
async def extract_refined_requirements(state: PipelineState) -> dict:
    qa_formatted = "\n".join([
        f"Q: {c.get('question', '')}\nA: {c.get('answer', '')}"
        for c in state.get("clarifications", [])
        if isinstance(c, dict)
    ])
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a Principal Requirements Analyst. Extract high-precision, 
testable, and quantified Functional Requirements (FR) and Non-Functional Requirements (NFR) 
by merging the meeting transcript with the stakeholder's clarification answers.

Categorize NFRs explicitly (Performance, Security, Reliability, Fairness, Explainability, etc.).
Ensure every vague statement from the transcript is replaced by the refined parameters.

Output JSON format:
{{
  "functional_requirements": ["FR1: ...", "FR2: ..."],
  "non_functional_requirements": {{
     "Performance": ["..."],
     "Fairness & Bias": ["..."],
     "Explainability": ["..."],
     "Reliability & Data": ["..."]
  }}
}}"""),
        ("human", "Raw Transcript:\n{transcript}\n\nStakeholder Clarifications:\n{clarifications}")
    ])
    chain = prompt | gemini_llm | JsonOutputParser()
    res = await chain.ainvoke({
        "transcript": state["raw_transcript"],
        "clarifications": qa_formatted if qa_formatted else "None provided."
    })
    return {
        "refined_fr": res.get("functional_requirements", []),
        "refined_nfr": res.get("non_functional_requirements", {})
    }

# Node 3: Evaluation & Comparison
async def evaluate_requirements(state: PipelineState) -> dict:
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an IEEE-830 Software Quality Auditor.
Compare the Baseline (Without Clarification) requirements against the Refined (With Clarification) requirements.

Evaluate each set on:
1. Ambiguity Score (1-10, where 10 is completely unambiguous & quantifiable)
2. Completeness Score (0-100%)
3. Verifiability / Testability (0-100%)
4. Actionability for Engineering (0-100%)

Provide:
- Comparative scores
- Qualitative analysis of gaps resolved by clarifications
- Final verdict on requirement quality improvement.

Output JSON format:
{{
  "metrics": {{
     "baseline": {{
        "ambiguity_score": 4.0,
        "completeness_score": 50,
        "verifiability_score": 35,
        "actionability_score": 40
     }},
     "refined": {{
        "ambiguity_score": 9.5,
        "completeness_score": 95,
        "verifiability_score": 92,
        "actionability_score": 94
     }}
  }},
  "key_improvements": ["...", "..."],
  "summary_comparison": "..."
}}"""),
        ("human", """Baseline Requirements:
FR: {b_fr}
NFR: {b_nfr}

Refined Requirements:
FR: {r_fr}
NFR: {r_nfr}""")
    ])
    chain = prompt | gemini_llm | JsonOutputParser()
    res = await chain.ainvoke({
        "b_fr": json.dumps(state["baseline_fr"]),
        "b_nfr": json.dumps(state["baseline_nfr"]),
        "r_fr": json.dumps(state["refined_fr"]),
        "r_nfr": json.dumps(state["refined_nfr"])
    })
    return {"evaluation_report": res}

# Compile Graph
builder = StateGraph(PipelineState)
builder.add_node("extract_baseline", extract_baseline_requirements)
builder.add_node("extract_refined", extract_refined_requirements)
builder.add_node("evaluate", evaluate_requirements)

builder.add_edge(START, "extract_baseline")
builder.add_edge("extract_baseline", "extract_refined")
builder.add_edge("extract_refined", "evaluate")
builder.add_edge("evaluate", END)

requirement_graph = builder.compile()
