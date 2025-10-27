// Store API key in localStorage for convenience
const API_KEY_STORAGE = 'openai_api_key';

// DOM elements
const apiKeyInput = document.getElementById('api-key');
const storyPromptInput = document.getElementById('story-prompt');
const storyLengthSelect = document.getElementById('story-length');
const generateBtn = document.getElementById('generate-btn');
const storyOutput = document.getElementById('story-output');
const loadingDiv = document.getElementById('loading');

// Load saved API key
window.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem(API_KEY_STORAGE);
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }
});

// Save API key when it changes
apiKeyInput.addEventListener('change', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        localStorage.setItem(API_KEY_STORAGE, apiKey);
    }
});

// Generate story on button click
generateBtn.addEventListener('click', generateStory);

// Allow Enter key in prompt (Ctrl+Enter to submit)
storyPromptInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        generateStory();
    }
});

async function generateStory() {
    const apiKey = apiKeyInput.value.trim();
    const prompt = storyPromptInput.value.trim();
    const length = storyLengthSelect.value;

    // Validate inputs
    if (!apiKey) {
        showError('Please enter your OpenAI API key');
        return;
    }

    if (!prompt) {
        showError('Please enter a story prompt');
        return;
    }

    // Show loading state
    generateBtn.disabled = true;
    loadingDiv.classList.add('active');
    storyOutput.style.display = 'none';

    try {
        // Construct the system message based on length
        const lengthInstructions = {
            short: 'Write a short story of 1-2 paragraphs.',
            medium: 'Write a medium-length story of 3-5 paragraphs.',
            long: 'Write a long story of 6-10 paragraphs.'
        };

        const systemMessage = lengthInstructions[length] + ' Make it engaging and creative.';

        // Call OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.8,
                max_tokens: getMaxTokens(length)
            })
        });

        if (!response.ok) {
            let errorMessage = 'Failed to generate story';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error?.message || errorMessage;
            } catch (e) {
                // If parsing JSON fails, use default message
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            throw new Error('Invalid response from OpenAI API');
        }
        
        // Validate message structure
        if (!data.choices[0].message || !data.choices[0].message.content) {
            throw new Error('Invalid message structure in API response');
        }
        
        const story = data.choices[0].message.content;
        
        // Validate story content is a string and not empty or whitespace
        if (typeof story !== 'string' || !story.trim()) {
            throw new Error('No story content in response');
        }

        // Display the story
        displayStory(story);

    } catch (error) {
        console.error('Error generating story:', error);
        showError(`Error: ${error.message}`);
    } finally {
        // Reset UI state
        generateBtn.disabled = false;
        loadingDiv.classList.remove('active');
        storyOutput.style.display = 'block';
    }
}

function getMaxTokens(length) {
    const tokens = {
        short: 300,
        medium: 800,
        long: 1500
    };
    return tokens[length] || 800;
}

function displayStory(story) {
    // Split story into paragraphs and format
    const paragraphs = story.split('\n').filter(p => p.trim());
    const formattedStory = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
    storyOutput.innerHTML = formattedStory;
}

function showError(message) {
    storyOutput.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
    storyOutput.style.display = 'block';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
