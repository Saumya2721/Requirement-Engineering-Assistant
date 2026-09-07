// Scrapes live captions in Google Meet or Zoom Web and forwards turns to popup
console.log("Requirement Engineering Assistant Content Script Loaded.");

let lastObservedText = "";

const captionObserver = new MutationObserver(() => {
  // Google Meet Caption Selector: div[jsname="YS01Ge"], div[class*="VfPpkd-"]
  // Zoom Web Caption Selector: .caption-content
  const meetCaptions = document.querySelector('div[jsname="YS01Ge"]');
  const zoomCaptions = document.querySelector('.caption-content');

  const activeCaptionNode = meetCaptions || zoomCaptions;
  if (activeCaptionNode) {
    const text = activeCaptionNode.innerText.trim();
    if (text && text !== lastObservedText && text.length > 15) {
      lastObservedText = text;
      chrome.runtime.sendMessage({
        type: "NEW_TRANSCRIPT_LINE",
        data: text
      });
    }
  }
});

captionObserver.observe(document.body, { childList: true, subtree: true });