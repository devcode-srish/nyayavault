import { GoogleGenAI, Type } from "@google/genai";
const pdfParse = require("pdf-parse");

// We use the Gemini API (version 1.5 flash or later)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "A concise, 3-4 bullet point overview of the document.",
    },
    entities: {
      type: Type.OBJECT,
      properties: {
        persons: { type: Type.ARRAY, items: { type: Type.STRING } },
        locations: { type: Type.ARRAY, items: { type: Type.STRING } },
        dates: { type: Type.ARRAY, items: { type: Type.STRING } },
        evidenceTags: { type: Type.ARRAY, items: { type: Type.STRING } },
        legalSections: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
    piiDetected: {
      type: Type.BOOLEAN,
      description: "True if sensitive data like Aadhaar, phone numbers, or minor names are detected.",
    },
  },
  required: ["summary", "entities", "piiDetected"],
};

export async function analyzeDocument(buffer: Buffer, mimeType: string) {
  let text = "";

  if (mimeType === "application/pdf") {
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (mimeType.startsWith("text/")) {
    text = buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported document type for AI analysis: ${mimeType}`);
  }

  if (!text.trim()) {
    throw new Error("Document contains no extractable text.");
  }

  // Bypass Gemini and return hardcoded deterministic response for Hackathon Demo
  if (process.env.AI_PROVIDER === "mock") {
    // Simulate a slight network delay to make it feel real
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      summary: [
        "This is a simulated AI analysis (Offline Demo Mode).",
        "The document outlines allegations of a coordinated cyber fraud operation.",
        "Crucial timeline events have been identified linking the suspect to the seized evidence."
      ],
      entities: {
        persons: ["Investigating Officer Rao", "Target Suspect"],
        locations: ["Suspect Residence", "Offshore Server"],
        dates: ["2026-09-28", "2026-01-15"],
        evidenceTags: ["Seized Laptop", "Financial Record"],
        legalSections: ["Cybercrime Act Sec 43", "Evidence Act Sec 65B"]
      },
      piiDetected: true
    };
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: `Analyze the following legal/investigation document and extract the required information based on the schema.\n\nDocument Text:\n${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2, // Low temperature for more deterministic/factual output
    },
  });

  if (!response.text) {
      throw new Error("AI returned empty response.");
  }

  return JSON.parse(response.text);
}
