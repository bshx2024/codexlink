const fs = require('fs');
const { probeTargetUrl } = require('/root/codexlink/.agents/skills/apivale-comment-outreach/scripts/probe_target.js');

const CANDIDATES = [
  "https://corporateleadersmagazine.com/startup-claims-new-ai-model-could-solve-one-of-the-biggest-llm-bottlenecks/",
  "https://pratikpathak.com/azure-openai-service-vs-openai-direct-architecture/",
  "https://milhaniq.com/building-your-own-gpt-assistant-with-power-automate-without-chatgpt-plus/",
  "https://cyberpress.org/openai-confirms-mixpanel-breach/",
  "https://gravitywiz.com/spotlight-social-media-gravity-forms-openai/",
  "https://wtit.com/blog/2026/07/31/foundational-ai-enterprise-guardrails/",
  "https://dataplatforms.ca/from-shared-chaos-to-clear-insights-model-logging-with-ai-gateway/",
  "https://ragnarheil.de/ai-gateway-or-llm-gateway-cdata-vs-azure-compared/",
  "https://humairahmed.com/blog/?p=10928",
  "https://blog.gridinsoft.com/stolen-ai-gateway-context/",
  "https://fridayaiclub.com/what-is-ai-agent-infrastructure/",
  "https://ezcloudinfo.com/2026/09/21/from-prompt-to-privilege-practical-guardrails-for-securing-agentic-ai-and-mcp/",
  "https://www.jdhodges.com/blog/claude-code-mcp-server-token-costs/",
  "https://techanek.com/tracking-token-usage-in-azure-ai-llms-with-api-management-apim/",
  "https://mina.ai.vn/2026/06/25/from-llm-to-ai-agent-the-evolutionary-journey-of-modern-artificial-intelligence/",
  "https://www.mariehaynes.com/how-i-built-algo-update-mcp/",
  "https://www.rushis.com/prompt-caching-stop-paying-your-ai-to-re-read-the-same-stuff/",
  "https://www.erwinmayer.com/2021/05/23/extending-gpt-3s-context-window-infinitely-by-storing-context-in-gpt-3-itself-or-in-secondary-layers/",
  "https://skillo.dev/news/ai/what-is-a-context-window-explained",
  "https://vrealize.it/2025/12/04/vcf-automation-9-programmatic-token-generation/",
  "https://inside-machinelearning.com/en/special-tokens/",
  "https://isbyr.com/add-new-llm-models-to-splunk-mltk/",
  "https://mswis.com/running-an-ai-agent-on-your-own-gpu-a-practical-walkthrough/",
  "https://the-diy-life.com/using-a-locally-running-ai-agent-to-build-an-entire-home-server/",
  "https://bytelake.com/2026/11/06/practical-ai-bytelake-projects-customer-stories-and-what-they-help-people-do/",
  "https://dejan.ai/blog/how-gpt-sees-the-web/",
  "https://cybercorner.tech/the-million-dollar-ceo-fraud-anatomy-of-a-business-email-compromise/",
  "https://mshaeri.com/blog/understanding-rag-agentic-ai-and-mcp-by-a-real-world-ai-assistant-example/",
  "https://www.mssqltips.com/sqlservertip/8075/build-an-llm-application-using-langchain/",
  "https://www.js-craft.io/blog/langchain-vs-langgraph/",
  "https://blogs.justenougharchitecture.com/building-java-applications-with-langchain4j-spring/",
  "https://vertexfrontier.com/llamaindex-vs-langchain/",
  "https://beabetterdev.com/2023/01/29/ecs-fargate-tutorial-with-fastapi/",
  "https://felixaugenstein.com/blog/building-genai-apps-with-langchain-fastapi-streamlit/",
  "https://pandco.studio/blog/building-an-ai-powered-application-with-fastapi-and-deplying-with-terraform/",
  "https://webrtchacks.com/measuring-the-response-latency-of-openais-webrtc-based-real-time-api/",
  "https://www.scalefree.com/blog/artificial-intelligence/agentic-ai-how-to-transition-to-production-with-langfuse/",
  "https://blog.softcrafter.net/optimizing-llm-rag-with-quantized-embeddings-and-milvus-for-low-latency-retrieval/",
  "https://desertva.com/va-vs-ai-agent-b2b/",
  "https://www.jamescroft.co.uk/software-engineering-with-ai-agents-less-typing-more-judgement/",
  "https://isbyr.com/learning-about-rag-and-vector-databases/",
  "https://www.tothenew.com/blog/gcpbuilding-a-rag-pipeline-with-alloydb-ai-and-vertex-ai/",
  "https://jshowers.com/normalizing-a-mess-of-documents-into-usable-data-ai-embeddings-rag-and-semantic-search/",
  "https://www.maxapex.com/blogs/rag-in-oracle-apex-24-2/",
  "https://www.sortresume.ai/onedrive-rag-chat-files-folders/",
  "https://rodolfo-alonso.com/anythingllm-your-local-rag-database",
  "https://unfoldai.com/what-is-rag/",
  "https://www.lpi.org/blog/2026/03/06/databases-for-ai-should-you-use-a-vector-database/",
  "https://www.azuredive.net/2024/06/rag-on-azure-ai-chatgpt-and-your-data-js/",
  "https://automatorplugin.com/automation-vs-ai/",
  "https://automateroyal.com/how-much-does-ai-automation-cost/",
  "https://codanics.com/freelancing-with-ai-agents-global-market/",
  "https://www.jamesserra.com/archive/2017/04/artificial-intelligence-defined/",
  "https://andrewjanowczyk.com/using-paquo-to-directly-interact-with-qupath-project-files-for-usage-in-digital-pathology-machine-learning/",
  "https://api.mattturck.com/mad2023/",
  "https://www.ocw-openmatters.org/2025/11/12/7-free-online-mit-courses-to-grasp-machine-learning/",
  "https://vascularspecialistonline.com/research-provides-stepping-stone-for-future-application-of-ai-in-vascular-surgery/",
  "https://www.projectrecover.org/leila-character-brings-machine-learning/",
  "https://pizza-metropolis.com/essential-data-science-skills-a-comprehensive-guide/"
];

async function run() {
  console.log(`Starting probe on ${CANDIDATES.length} candidates...`);
  const passed = [];
  const blocked = [];
  const seenDomains = new Set();

  for (let i = 0; i < CANDIDATES.length; i++) {
    const u = CANDIDATES[i];
    try {
      const parsed = new URL(u);
      const normDomain = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (seenDomains.has(normDomain)) {
        blocked.push({ url: u, reason: 'Duplicate domain in candidate list' });
        continue;
      }

      const res = await probeTargetUrl(u);
      if (res.canProceed) {
        seenDomains.add(normDomain);
        passed.push({
          url: u,
          domain: res.domain,
          title: res.meta.title || ''
        });
        console.log(`[PASS ${passed.length}] ${res.domain} -> ${res.meta.title.slice(0, 40)}`);
      } else {
        blocked.push({
          url: u,
          domain: res.domain,
          gate: res.blockingGate,
          reason: res.blockingReason
        });
        console.log(`[BLOCK] ${res.domain} -> ${res.blockingGate}: ${res.blockingReason}`);
      }
    } catch (e) {
      blocked.push({ url: u, error: e.message });
      console.log(`[ERROR] ${u} -> ${e.message}`);
    }
  }

  console.log(`\n================================`);
  console.log(`Total passed: ${passed.length} / ${CANDIDATES.length}`);
  console.log(`Total blocked: ${blocked.length}`);
  console.log(`================================`);

  fs.writeFileSync('/root/codexlink/scripts/probed_passed_candidates.json', JSON.stringify(passed, null, 2), 'utf8');
}

run();
