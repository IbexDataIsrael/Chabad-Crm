// fixes111: single chat adapter for the AI helper popup. The UI never calls
// fetch directly — every message goes through sendChatMessage below.
//
// The real backend endpoint and auth contract are NOT decided yet. Wiring the
// popup to the server must then be a one-file change inside this module (add
// the apiFetch call in sendChatMessage and map its body to AssistantResponse).
// Until then: production honestly reports "not connected", and development
// serves mocked fixtures so each panel state can be seen and checked.

export type AssistantStatus = "answer" | "insufficient_sources" | "clarify" | "not_connected";

export interface AssistantPassage {
  filename: string;
  heading: string;
  score: number;
}

export interface AssistantResponse {
  status: AssistantStatus;
  reply?: string;
  passages?: AssistantPassage[];
}

const MOCK_DELAY_MS = 800;

function mockReply(message: string): AssistantResponse {
  const text = message.toLowerCase();
  if (text.includes("insufficient") || text.includes("לא מספיק")) {
    return { status: "insufficient_sources" };
  }
  if (text.includes("clarify")) {
    return { status: "clarify", reply: "Which date range do you mean?" };
  }
  if (text.includes("nosources")) {
    return { status: "answer", reply: "This answer comes without any source passages." };
  }
  return {
    status: "answer",
    reply: "This is a mocked development answer. It is clearly labelled as such and proves the answer state.",
    passages: [
      { filename: "donations_policy.md", heading: "Recording a donation", score: 0.92 },
      { filename: "contacts_guide.md", heading: "Creating a contact", score: 0.81 },
      { filename: "events_setup.md", heading: "Setting up an event", score: 0.67 },
    ],
  };
}

export async function sendChatMessage(message: string): Promise<AssistantResponse> {
  if (process.env.NODE_ENV !== "development") {
    // fixes111: no server endpoint exists yet — say so honestly instead of
    // inventing a URL or faking an answer.
    return { status: "not_connected" };
  }
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  if (message.toLowerCase().includes("error")) {
    throw new Error("mock failure");
  }
  return mockReply(message);
}
