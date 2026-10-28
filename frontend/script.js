
"use strict";

// ============================================
// QuickVote - Frontend and Backend Integration
// ============================================

const API_BASE_URL = "http://localhost:3000/api";

const pollList = document.getElementById("poll-list");
const pollCount = document.getElementById("poll-count");
const createPollForm = document.getElementById("create-poll-form");
const formMessage = document.getElementById("form-message");
const resultsSection = document.getElementById("results");
const resultsContent = document.getElementById("results-content");
const backToPollsButton = document.getElementById("back-to-polls");

let polls = [];

// --------------------------------------------
// Voter ID
// --------------------------------------------

// This identifies the browser, not a verified person.
// Clearing browser storage or switching browsers can bypass it.
function getVoterId() {
    const storageKey = "quickvote_voter_id";
    let voterId = localStorage.getItem(storageKey);

    if (!voterId) {
        if (!window.crypto || !window.crypto.randomUUID) {
            throw new Error(
                "Your browser does not support secure UUID generation."
            );
        }

        voterId = window.crypto.randomUUID();
        localStorage.setItem(storageKey, voterId);
    }

    return voterId;
}

// --------------------------------------------
// API helper
// --------------------------------------------

async function apiRequest(endpoint, options = {}) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options.headers
            }
        });
    } catch {
        throw new Error(
            "Cannot connect to the backend. Make sure the server is running at http://localhost:3000."
        );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

// --------------------------------------------
// Safe HTML helpers
// --------------------------------------------

function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined) {
        element.textContent = text;
    }

    return element;
}

function showMessage(element, message, type = "error") {
    element.textContent = message;
    element.className = `form-message ${type}`;
}

// --------------------------------------------
// Load and display polls
// --------------------------------------------

async function loadPolls() {
    pollList.replaceChildren(
        createElement("p", "empty-message", "Loading polls...")
    );

    try {
        polls = await apiRequest("/polls");
        renderPolls();
    } catch (error) {
        pollList.replaceChildren(
            createElement("p", "empty-message", error.message)
        );

        pollCount.textContent = "Unavailable";

        const retryButton = createElement(
            "button",
            "button button-secondary",
            "Try Again"
        );

        retryButton.type = "button";
        retryButton.addEventListener("click", loadPolls);
        pollList.appendChild(retryButton);
    }
}

function renderPolls() {
    pollList.replaceChildren();
    pollCount.textContent = `${polls.length} ${
        polls.length === 1 ? "poll" : "polls"
    }`;

    if (polls.length === 0) {
        pollList.appendChild(
            createElement(
                "p",
                "empty-message",
                "No polls yet. Create the first one!"
            )
        );
        return;
    }

    polls.forEach(poll => {
        const card = createElement("article", "poll-card");
        const heading = createElement("h3", "poll-question", poll.question);
        const optionsContainer = createElement("div", "poll-options");
        const radioGroupName = `poll-${poll.id}`;
        const voteForm = createElement("form", "vote-form");
        const message = createElement("p", "form-message");
        const buttonRow = createElement("div", "poll-actions");

        message.setAttribute("role", "status");

        poll.poll_options.forEach(option => {
            const label = createElement("label", "option-label");
            const radio = document.createElement("input");

            radio.type = "radio";
            radio.name = radioGroupName;
            radio.value = String(option.id);
            radio.required = true;

            label.append(radio, document.createTextNode(` ${option.option_text}`));
            optionsContainer.appendChild(label);
        });

        const voteButton = createElement(
            "button",
            "button button-primary",
            "Submit Vote"
        );

        voteButton.type = "submit";

        const resultsButton = createElement(
            "button",
            "button button-secondary",
            "View Results"
        );

        resultsButton.type = "button";
        resultsButton.addEventListener("click", () => {
            loadResults(poll.id);
        });

        voteForm.append(optionsContainer, message, voteButton);

        buttonRow.appendChild(resultsButton);
        card.append(heading, voteForm, buttonRow);
        pollList.appendChild(card);

        voteForm.addEventListener("submit", async event => {
            event.preventDefault();
            message.textContent = "";

            const selectedOption = voteForm.querySelector(
                'input[type="radio"]:checked'
            );

            if (!selectedOption) {
                showMessage(message, "Please select an option.");
                return;
            }

            voteButton.disabled = true;
            voteButton.textContent = "Submitting...";

            try {
                const voterId = getVoterId();

                const result = await apiRequest(
                    `/polls/${poll.id}/vote`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            option_id: Number(selectedOption.value),
                            voter_id: voterId
                        })
                    }
                );

                showMessage(message, result.message, "success");

                await loadResults(poll.id);
                await loadPolls();
            } catch (error) {
                showMessage(message, error.message);
            } finally {
                voteButton.disabled = false;
                voteButton.textContent = "Submit Vote";
            }
        });
    });
}

// --------------------------------------------
// Create a new poll
// --------------------------------------------

createPollForm.addEventListener("submit", async event => {
    event.preventDefault();

    const questionInput = document.getElementById("poll-question");
    const optionOneInput = document.getElementById("option-one");
    const optionTwoInput = document.getElementById("option-two");

    const question = questionInput.value.trim();
    const optionOne = optionOneInput.value.trim();
    const optionTwo = optionTwoInput.value.trim();

    if (!question || !optionOne || !optionTwo) {
        showMessage(formMessage, "Please fill in all fields.");
        return;
    }

    if (question.length > 200) {
        showMessage(formMessage, "The question must be at most 200 characters.");
        return;
    }

    if (optionOne.length > 100 || optionTwo.length > 100) {
        showMessage(formMessage, "Each option must be at most 100 characters.");
        return;
    }

    if (optionOne.toLowerCase() === optionTwo.toLowerCase()) {
        showMessage(formMessage, "Please enter two different options.");
        return;
    }

    const submitButton = createPollForm.querySelector(
        'button[type="submit"]'
    );

    submitButton.disabled = true;
    submitButton.textContent = "Creating...";

    try {
        await apiRequest("/polls", {
            method: "POST",
            body: JSON.stringify({
                question,
                options: [optionOne, optionTwo]
            })
        });

        createPollForm.reset();

        showMessage(formMessage, "Poll created successfully!", "success");

        await loadPolls();

        document.getElementById("polls").scrollIntoView({
            behavior: "smooth"
        });
    } catch (error) {
        showMessage(formMessage, error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Create Poll";
    }
});

// --------------------------------------------
// Load and display poll results
// --------------------------------------------

async function loadResults(pollId) {
    resultsSection.hidden = false;

    resultsContent.replaceChildren(
        createElement("p", "empty-message", "Loading results...")
    );

    resultsSection.scrollIntoView({ behavior: "smooth" });

    try {
        const result = await apiRequest(`/polls/${pollId}/results`);

        resultsContent.replaceChildren();

        const question = createElement("h3", "poll-question", result.question);

        const total = createElement(
            "p",
            "results-total",
            `Total votes: ${result.total_votes}`
        );

        resultsContent.append(question, total);

        result.options.forEach(option => {
            const row = createElement("div", "result-option");
            const labelRow = createElement("div", "result-label");
            const name = createElement("span", "", option.option_text);

            const percentage = createElement(
                "span",
                "",
                `${option.percentage}% (${option.votes} ${
                    option.votes === 1 ? "vote" : "votes"
                })`
            );

            const track = createElement("div", "result-track");
            const bar = createElement("div", "result-bar");

            bar.style.width = `${option.percentage}%`;
            track.setAttribute("aria-label", `${option.percentage}% of votes`);
            track.appendChild(bar);

            labelRow.append(name, percentage);
            row.append(labelRow, track);
            resultsContent.appendChild(row);
        });
    } catch (error) {
        resultsContent.replaceChildren(
            createElement("p", "empty-message", error.message)
        );
    }
}

// --------------------------------------------
// Navigation
// --------------------------------------------

backToPollsButton.addEventListener("click", () => {
    resultsSection.hidden = true;

    document.getElementById("polls").scrollIntoView({
        behavior: "smooth"
    });
});

// --------------------------------------------
// Start the application
// --------------------------------------------

loadPolls();
