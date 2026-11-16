// Shared Groq settings. llama-3.3-70b-versatile and llama-4-scout were shut down in 2026;
// see https://console.groq.com/docs/deprecations when a model stops working.
const GROQ_MODEL = 'qwen/qwen3.8-27b'; // multimodal: used for receipt images and text

// Strip any <think>...</think> reasoning a model may prepend to its answer
function answerText(data) {
  return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

module.exports = { GROQ_MODEL, answerText };
