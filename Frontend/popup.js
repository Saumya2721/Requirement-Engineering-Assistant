const BACKEND_URL = "http://127.0.0.1:8000";

let fullTranscript = [];
let cycleBuffer = []; // Buffer for 1-cycle (Q&A pair)
let pendingClarifications = [];
let answeredClarifications = [];
let finalResultData = null;
let samplePlaybackAbort = false;
let isAnalyzing = false; // In-flight request guard to prevent overlapping API calls

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  renderTranscript();
  renderAllClarificationCards();
  if (finalResultData) {
    displayResults(finalResultData);
  }
});

// Tab Switching
document.getElementById('tab-clarify').addEventListener('click', () => switchTab('view-clarify', 'tab-clarify'));
document.getElementById('tab-results').addEventListener('click', () => switchTab('view-results', 'tab-results'));

function switchTab(viewId, btnId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.getElementById(btnId).classList.add('active');
}

// State Management
async function saveState() {
  await chrome.storage.local.set({
    fullTranscript,
    cycleBuffer,
    pendingClarifications,
    answeredClarifications,
    finalResultData
  });
}

async function loadState() {
  const data = await chrome.storage.local.get([
    'fullTranscript',
    'cycleBuffer',
    'pendingClarifications',
    'answeredClarifications',
    'finalResultData'
  ]);
  
  if (data.fullTranscript) fullTranscript = data.fullTranscript;
  if (data.cycleBuffer) cycleBuffer = data.cycleBuffer;
  if (data.pendingClarifications) pendingClarifications = data.pendingClarifications;
  if (data.answeredClarifications) answeredClarifications = data.answeredClarifications;
  if (data.finalResultData) finalResultData = data.finalResultData;
}

function renderTranscript() {
  const feed = document.getElementById('transcript-feed');
  feed.innerHTML = ''; // Clear first (safe as we don't put user input here directly)
  fullTranscript.forEach(statement => {
    const div = document.createElement('div');
    div.textContent = `• ${statement}`;
    feed.appendChild(div);
  });
  feed.scrollTop = feed.scrollHeight;
}

// Process a single speaker statement with cycle buffering (QA pair)
async function processTurn(statement) {
  if (!statement || !statement.trim()) return;
  
  fullTranscript.push(statement);
  cycleBuffer.push(statement);
  await saveState();
  
  const feed = document.getElementById('transcript-feed');
  const div = document.createElement('div');
  div.textContent = `• ${statement}`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;

  // Trigger analysis only when a complete 1-cycle (Q&A pair) is formed
  if (cycleBuffer.length >= 2) {
    const exchangeToAnalyze = cycleBuffer.join("\n");
    cycleBuffer = []; // Reset cycle buffer
    await saveState();

    if (isAnalyzing) {
      console.warn("Analysis in progress, skipping overlapping turn.");
      return;
    }

    isAnalyzing = true;
    try {
      const response = await fetch(`${BACKEND_URL}/api/analyze-turn`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-api-key": "default-secret-key"
        },
        body: JSON.stringify({
          context: fullTranscript.slice(-6, -2).join("\n"), 
          latest_statement: exchangeToAnalyze
        })
      });

      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.has_ambiguity && result.clarification_question) {
        pendingClarifications.push({
          id: "card-" + Date.now(),
          question: result.clarification_question,
          phrases: result.ambiguous_phrases || []
        });
        await saveState();
        renderAllClarificationCards();
      }
    } catch (err) {
      console.error("Analysis Error:", err);
    } finally {
      isAnalyzing = false;
    }
  }
}

function renderAllClarificationCards() {
  const container = document.getElementById('clarifications-container');
  container.innerHTML = '';
  
  pendingClarifications.forEach(item => {
    renderClarificationCard(item.id, item.question, item.phrases, false);
  });
  
  answeredClarifications.forEach(item => {
    renderClarificationCard(item.id, item.question, item.phrases, true, item.answer);
  });
}

// Render dynamic Question Cards safely against XSS
function renderClarificationCard(cardId, question, phrases, isResolved, answerText = "") {
  const container = document.getElementById('clarifications-container');

  const card = document.createElement('div');
  card.className = 'card';
  card.id = cardId;
  
  if (isResolved) {
    card.style.opacity = '0.5';
    const p = document.createElement('p');
    p.textContent = `✅ Resolved: ${question}`;
    
    const i = document.createElement('i');
    i.textContent = `Ans: ${answerText}`;
    
    card.appendChild(p);
    card.appendChild(i);
  } else {
    const pFlagged = document.createElement('p');
    const strongFlagged = document.createElement('strong');
    strongFlagged.textContent = "Flagged: ";
    pFlagged.appendChild(strongFlagged);
    pFlagged.appendChild(document.createTextNode(`"${phrases.join(', ')}"`));
    
    const pAI = document.createElement('p');
    const strongAI = document.createElement('strong');
    strongAI.textContent = "AI Clarification: ";
    pAI.appendChild(strongAI);
    pAI.appendChild(document.createTextNode(question));
    
    const input = document.createElement('input');
    input.type = "text";
    input.placeholder = "Type stakeholder answer...";
    input.id = `input-${cardId}`;
    
    const button = document.createElement('button');
    button.id = `btn-${cardId}`;
    button.textContent = "Submit Response";
    
    button.addEventListener('click', async () => {
      const answer = input.value;
      if (!answer) return;
      
      // Move from pending to answered
      pendingClarifications = pendingClarifications.filter(c => c.id !== cardId);
      answeredClarifications.push({ id: cardId, question, phrases, answer });
      await saveState();
      renderAllClarificationCards();
    });
    
    card.appendChild(pFlagged);
    card.appendChild(pAI);
    card.appendChild(input);
    card.appendChild(button);
  }

  container.appendChild(card);
}

// Event Listeners for Manual & Sample testing
document.getElementById('send-turn-btn').addEventListener('click', () => {
  const input = document.getElementById('manual-turn-input');
  processTurn(input.value);
  input.value = "";
});

// Load the exact conversation from Assignment 2
document.getElementById('load-sample-btn').addEventListener('click', async () => {
  samplePlaybackAbort = false;
  const sampleDialogue = [
    "Hiring Manager: We need to build an AI-based resume analyzer that can automatically shortlist candidates for our software engineering roles.",
    "ML Engineer: Okay. How should the system decide which candidates to shortlist?",
    "Hiring Manager: It should rank them based on relevance to the job description.",
    "ML Engineer: How are we defining relevance?",
    "Hiring Manager: Mainly skills and experience. And overall profile strength like good companies and solid projects.",
    "ML Engineer: Should we prioritize years of experience?",
    "Hiring Manager: Yes, but not strictly. Sometimes a strong fresher is better than someone with 5 average years.",
    "ML Engineer: Do we have historical hiring data to train the system?",
    "Hiring Manager: We have past resumes and hiring decisions, but they're not very structured.",
    "ML Engineer: How accurate should the system be?",
    "Hiring Manager: It should be good enough so that HR trusts it.",
    "ML Engineer: Do we need explainability? For example, why a candidate was ranked higher?",
    "Hiring Manager: Yes, that would be useful.",
    "ML Engineer: Are there any constraints regarding bias or fairness?",
    "Hiring Manager: Yes, we must avoid bias, especially related to gender or college background.",
    "ML Engineer: Should the system process resumes in real-time or batch mode?",
    "Hiring Manager: It shouldn't be slow.",
    "ML Engineer: What is the expected response time per resume?",
    "Hiring Manager: Ideally quick.",
    "ML Engineer: What is the timeline for delivery?",
    "Hiring Manager: We need an MVP soon."
  ];

  for (const line of sampleDialogue) {
    if (samplePlaybackAbort) break; // Check if we should abort
    await new Promise(r => setTimeout(r, 2500));
    if (samplePlaybackAbort) break;
    await processTurn(line);
  }
});

// Clean up sample playback on window unload
window.addEventListener('unload', () => {
  samplePlaybackAbort = true;
});

// Finalize and trigger LangGraph requirement synthesis
document.getElementById('finalize-btn').addEventListener('click', async () => {
  document.getElementById('finalize-btn').innerText = "Synthesizing Requirements...";
  try {
    const response = await fetch(`${BACKEND_URL}/api/synthesize`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-api-key": "default-secret-key"
      },
      body: JSON.stringify({
        raw_transcript: fullTranscript.join("\n"),
        clarifications: answeredClarifications
      })
    });
    
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.detail || `Server error (${response.status})`);
    }

    finalResultData = await response.json();
    await saveState();
    displayResults(finalResultData);
    switchTab('view-results', 'tab-results');
  } catch (err) {
    showToast("Error synthesizing requirements: " + err.message);
  } finally {
    document.getElementById('finalize-btn').innerText = "Finalize & Synthesize Requirements";
  }
});

function displayResults(data) {
  const metrics = data.evaluation_report.metrics;
  const baselineScores = document.getElementById('baseline-scores');
  baselineScores.innerHTML = '';
  baselineScores.appendChild(document.createTextNode(`• Ambiguity: ${metrics.baseline.ambiguity_score}/10`));
  baselineScores.appendChild(document.createElement('br'));
  baselineScores.appendChild(document.createTextNode(`• Completeness: ${metrics.baseline.completeness_score}%`));
  baselineScores.appendChild(document.createElement('br'));
  baselineScores.appendChild(document.createTextNode(`• Verifiability: ${metrics.baseline.verifiability_score}%`));

  const refinedScores = document.getElementById('refined-scores');
  refinedScores.innerHTML = '';
  refinedScores.appendChild(document.createTextNode(`• Ambiguity: ${metrics.refined.ambiguity_score}/10`));
  refinedScores.appendChild(document.createElement('br'));
  refinedScores.appendChild(document.createTextNode(`• Completeness: ${metrics.refined.completeness_score}%`));
  refinedScores.appendChild(document.createElement('br'));
  refinedScores.appendChild(document.createTextNode(`• Verifiability: ${metrics.refined.verifiability_score}%`));

  const requirementsDisplay = document.getElementById('requirements-display');
  requirementsDisplay.innerHTML = ''; // Safe to clear
  
  const h4Fr = document.createElement('h4');
  h4Fr.textContent = 'Functional Requirements (FR)';
  requirementsDisplay.appendChild(h4Fr);
  
  const ulFr = document.createElement('ul');
  data.refined_fr.forEach(fr => { 
    const li = document.createElement('li');
    li.textContent = fr;
    ulFr.appendChild(li);
  });
  requirementsDisplay.appendChild(ulFr);
  
  const h4Nfr = document.createElement('h4');
  h4Nfr.textContent = 'Categorized Non-Functional Requirements (NFR)';
  requirementsDisplay.appendChild(h4Nfr);
  
  for (const [cat, reqs] of Object.entries(data.refined_nfr)) {
    const b = document.createElement('b');
    b.textContent = `${cat}:`;
    requirementsDisplay.appendChild(b);
    
    const ul = document.createElement('ul');
    reqs.forEach(r => { 
      const li = document.createElement('li');
      li.textContent = r;
      ul.appendChild(li);
    });
    requirementsDisplay.appendChild(ul);
  }
}

// Document Export Handler
document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!finalResultData) {
      showToast("Please synthesize requirements first!");
      return;
    }
    const format = btn.getAttribute('data-type');
    const res = await fetch(`${BACKEND_URL}/api/export`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-api-key": "default-secret-key"
      },
      body: JSON.stringify({ format: format, data: finalResultData })
    });
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Requirements_Report.${format}`;
    a.click();
  });
});

// Simple toast notification system
function showToast(message) {
  let toast = document.getElementById('toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#333';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '4px';
    toast.style.fontSize = '12px';
    toast.style.zIndex = '1000';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Listen for live captions forwarded from content.js (Google Meet / Zoom)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "NEW_TRANSCRIPT_LINE" && message.data) {
    processTurn(message.data);
  }
});