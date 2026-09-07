from typing import TypedDict, List, Dict, Any, Optional
from pydantic import BaseModel

class AmbiguityAnalysis(BaseModel):
    has_ambiguity: bool
    ambiguous_phrases: List[str]
    clarification_question: Optional[str]
    category: Optional[str]

class PipelineState(TypedDict):
    raw_transcript: str
    clarifications: List[Dict[str, Any]] # [{'question': '...', 'answer': '...'}]
    baseline_fr: List[str]
    baseline_nfr: Dict[str, List[str]]
    refined_fr: List[str]
    refined_nfr: Dict[str, List[str]]
    evaluation_report: Dict[str, Any]

class TurnRequest(BaseModel):
    context: str
    latest_statement: str

class SynthesisRequest(BaseModel):
    raw_transcript: str
    clarifications: List[Dict[str, Any]] = []
