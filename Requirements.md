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
- There is an autoplay switch, which will automatically read the next chapter when the current one is finished. That is enabled by default.

## Some technical details

- The OpenAI API key is stored in local storage at `chatgpt_api_key`. If that is not present, it is requested from the user by `prompt`. It should not be shown in the UI.
- It's done serverless in HTML+CSS+JavaScript. 
- We will use the OpenAI APIs. And bootstrap for formatting, imported from CDN.
- For the development server the files are served from directory src/.
