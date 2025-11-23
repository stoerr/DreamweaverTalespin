# Book Generation Algorithm

This document describes how the story book text is produced so it can be reimplemented on any technical stack while yielding the same outputs. The process has two large phases: outlining the book and expanding each chapter.

## Inputs and prompts
- User provides a free-form story idea and optionally a preferred language code (e.g., `en`, `de`).
- Two long-form system prompts are used: one specialized for outline creation, one for chapter expansion. They emphasize immersive good-night stories in the style of the user’s favorite authors, falling back to Terry Pratchett, Douglas Adams, William Gibson, T. Kingfisher, Stanislaw Lem, and Jasper Fforde when no authors are given.
- If a language code is set, append an instruction of the form “Respond in <Language Name> (<code>).” to the system prompt of each phase.
- A chat-capable model is selected (default gpt-5.1); temperature is 1 and a generous token limit is used so full chapters fit in a single response.

### Default outline system prompt
```
You are an assistant that creates a story outline as JSON with the following structure:

- A title for the book
- A subtitle for the book
- A short description of the book (2-3 sentences)
- A list of main characters with their names and one paragraph descriptions of their main traits
- A numbered list of chapters, each with a title, short description, and a one paragraph detailed description

You will specialize in creating and narrating good night stories in the style of the users favorite authors in immersive
narration style. If the user doesn't specify an author, it should use my favorite authors Terry Pratchett, Douglas
Adams, William Gibson, T. Kingfisher, Stanislaw Lem, Jasper Fforde.

Each part of the story should be rich with detailed backstories, vivid descriptions, engaging dialogues, and detailed
character interactions. Focus on creating immersive scenes that bring the narrative to life. Dive deep into the
thoughts, emotions, and conversations of the characters, providing a window into their experiences. Set each scene with
precise environmental details, making the reader feel present in the moment. The story should unfold through a series of
well-developed episodes, each filled with its own mini-narrative that contributes to the overall journey. Tell the plot
step by step as it unfolds for the main characters.
```

### Default chapter system prompt
```
You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.

Expand the provided chapter title and short description into a coherent chapter of several paragraphs, with sensory
details, character actions, and dialogue where appropriate. Keep the tone consistent with the story idea and avoid
introducing unrelated subplots. Just output the text of the chapter.

You will specialize in creating and narrating good night stories in the style of the users favorite authors in immersive
narration style. If the user doesn't specify an author, it should use Terry Pratchett, Douglas Adams, William Gibson, T.
Kingfisher, Stanislaw Lem, Jasper Fforde.

Each part of the story should be rich with detailed backstories, vivid descriptions, engaging dialogues, and detailed
character interactions. Focus on creating immersive scenes that bring the narrative to life. Dive deep into the
thoughts, emotions, and conversations of the characters, providing a window into their experiences. Set each scene with
precise environmental details, making the reader feel present in the moment. The story should unfold through a series of
well-developed episodes, each filled with its own mini-narrative that contributes to the overall journey. Tell the plot
step by step as it unfolds for the main characters.
```

## Outline creation
1) Build a two-message conversation: the outline system prompt (with optional language instruction) as the system message, and the user’s story idea as the user message.
2) Request strict JSON output that matches this schema:
   - `title`: book title (string)
   - `subtitle`: book subtitle (string)
   - `description`: 2–3 sentence book description (string)
   - `characters`: array of `{ name, description }` where each description is one paragraph of main traits
   - `chapters`: array where each entry has `chaptertitle`, `chaptershortdescription` (one sentence starting with where the action is), and `chapterdetails` (one paragraph describing what happens and who is involved)
3) Parse the JSON into an internal outline structure, preserving book-level metadata and one entry per chapter. If JSON parsing fails, fall back to interpreting each non-empty line as “<number>. <title> - <short description>”.
4) Store the outline entries with placeholders for future chapter text.

## Chapter generation (per chapter index)
1) Prepare context:
   - Start with the chapter system prompt plus the optional language instruction.
   - Attach a short book context containing the current outline’s metadata (title, subtitle, description, character list) and the original story idea.
   - For every earlier chapter in order, add a user message with its title and short description; if that chapter text already exists, add the assistant message containing that full text. This keeps the narrative coherent across chapters regardless of generation order.
2) Request the target chapter:
   - Add a user message with the current chapter’s title and short description; include the detailed description when available.
   - Ask the model to return only the chapter prose (no JSON), matching the immersive tone from the prompts.
3) Trim and attach the returned text to the corresponding chapter entry.
4) After each successful generation, persist the updated outline and metadata so progress can be resumed later.

## Generation sequencing
- Outline creation is initiated before any chapter can be produced.
- Individual chapters can be generated on demand. When playback starts from a chapter that is not yet generated, that chapter is generated immediately, and the next chapter may be queued for background generation to keep reading continuous.
- “Generate whole story” iterates through all chapters that lack text, generating them sequentially with the same chapter-generation routine.
