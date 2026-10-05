import { MatchWorkspace } from "@/components/MatchWorkspace";

const REPO_URL = "https://github.com/ahsanullahdaud/creator-match";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl dark:text-zinc-50">
            Creator Match
          </h1>
          <p className="max-w-xl text-base text-zinc-600 sm:text-lg dark:text-zinc-400">
            Describe the brand and who it is for. Get a shortlist of YouTube
            creators with a fit score and a first message for each.
          </p>
        </header>
        <MatchWorkspace />
      </main>
      <footer className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 py-6 text-xs text-zinc-500 sm:px-6">
        <p>
          Runs on the Gemini API free tier and public YouTube Data API results.
          Google may use free-tier prompts to improve its products, so keep
          briefs non-confidential. Results are cached for 7 days and nothing
          else is stored. No account needed.
        </p>
        <p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Source on GitHub
          </a>
          {" · "}
          Built with{" "}
          <a
            href="https://claude.com/claude-code"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Claude Code
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
