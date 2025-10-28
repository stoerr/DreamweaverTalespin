# Story teller

## Basic idea

The basic idea of this project is to create stories and read them aloud. 
That will work in two steps. 
First, a general outline of the story is created, with a description for each chapter.
Second, all the chapters are created, chapter by chapter.
And third, the chapters will be read aloud, one after each other, while the next chapter is being prepared in the background.

## Some technical details

The OpenAI API key is stored in local storage at `chatgpt_api_key`. If that is not present, it is requested from the user by `prompt`.
It's done serverless in HTML+CSS+JavaScript. 
We will use the OpenAI APIs. And bootstrap for formatting, imported from CDN.
The files are served from directory src/.
There are input fields for system prompts for the outline generation and for the chapter generation.
