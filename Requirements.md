# Story teller

## Basic idea

The basic idea of this project is to create stories and read them aloud. 
That will work in two steps. 
First, a general outline of the story is created, with a description for each chapter.
Second, all the chapters are created, chapter by chapter.
And third, the chapters will be read aloud, one after each other, while the next chapter is being prepared in the background.

## Some UI Details

- There are input fields for system prompts for the outline generation and for the chapter generation.
- The text of each chapter will be displayed and there is a play button for reading that chapter aloud. It is highlighted while being read.
- The play button should be disabled when the story is being generated or read. Pressing the play button starts the generation, though.
- There is an autoplay switch, which will automatically read the next chapter when the current one is finished. That is enabled by default.
- There should be a language selector that influences both the story generation and the text-to-speech voice. (The voice names e.g. contain `en-` for english, `de-` for German, etc. - only the voices matching those have to be shown in the selector.)
- There should be a dropdown with examples for story ideas just below the story prompt. Selecting one fills the story idea input field.
- The voices should be sorted by quality (highest quality first).
- The last story prompt should be stored in local storage and restored on reload - key 'net.stoerr.aiexperiments.storyteller.storyprompt'. Similarily, store the last voice selection.
- Setting the focus in a text area should enlarge that area to 10 lines, and reduce it again on blur.

## Some technical details

- The OpenAI API key is stored in local storage at `chatgpt_api_key`. If that is not present, it is requested from the user by `prompt`. It should not be shown in the UI.
- It's done serverless in HTML+CSS+JavaScript. 
- We will use the OpenAI APIs. And bootstrap for formatting, imported from CDN.
- For the development server the files are served from directory src/.
