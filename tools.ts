import { tool, generateText } from "ai";
import { simpleGit } from "simple-git";
import { z } from "zod";
import { CommitParser } from "conventional-commits-parser"
import { commitMessagePrompt } from "./prompts";
import { google } from "@ai-sdk/google";

const excludeFiles = ["dist", "bun.lock"];

const fileChange = z.object({
  rootDir: z.string().min(1).describe("The root directory"),
});

type FileChange = z.infer<typeof fileChange>;
const commitMessageInput = z.object({
    rootDir: z.string().min(1).describe("The root directory to analyze changes from")
})
type CommitMessageInput = z.infer<typeof commitMessageInput>

async function getFileChangesInDirectory({ rootDir }: FileChange) {
  const git = simpleGit(rootDir);
  const summary = await git.diffSummary();
  const diffs: { file: string; diff: string }[] = [];

  for (const file of summary.files) {
    if (excludeFiles.includes(file.file)) continue;
    const diff = await git.diff(["--", file.file]);
    diffs.push({ file: file.file, diff });
  }

  return diffs;
}
async function generateCommitMessage({rootDir}: CommitMessageInput){
    // Get diffs using existing function
    const diffs = await getFileChangesInDirectory({rootDir})

    if(diffs.length === 0){
        return "chore: no changes detected."
    }
    // Summarize diffs into a string for LLM
    const changesSummary = diffs.map(d=>`File: ${d.file} \nChanges: ${d.diff}`).join("\n\n");

    // Ask LLM to generate a professional commit message
    const {text} = await generateText({
        model: google("models/gemini-2.5-flash"),
        system: "You are a professional engineer. Only output a Conventional Commit message.",
        prompt: commitMessagePrompt(changesSummary)
    })

    const rawMessage = text.trim()

    // Validate generated commit with parser from conventional commit parser
    const parser = new CommitParser()
    const parsed = parser.parse(rawMessage)

    if(!parsed.type || !parsed.subject){
        throw new Error("Generated commit message is not a valid Conventional Commit")
    }

    // Return the clean commit message
    return rawMessage
}

export const getFileChangesInDirectoryTool = tool({
  description: "Gets the code changes made in given directory",
  inputSchema: fileChange,
  execute: getFileChangesInDirectory,
});
export const generateCommitMessageTool = tool({
    description: "Generate a professional conventional commit message.",
    inputSchema: commitMessageInput,
    execute: generateCommitMessage,
})