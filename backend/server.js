require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");
const supabase = require("./supabase");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20kb" }));

// Basic health check
app.get("/", (req, res) => {
    res.json({
        message: "QuickVote API is running",
        status: "OK"
    });
});

// Get all active polls and their options
app.get("/api/polls", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("polls")
            .select(`
                id,
                question,
                created_at,
                poll_options (
                    id,
                    option_text
                )
            `)
            .eq("is_active", true)
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error("Get polls error:", error.message);
        res.status(500).json({ error: "Unable to retrieve polls." });
    }
});

// Get one poll
app.get("/api/polls/:id", async (req, res) => {
    const pollId = Number(req.params.id);

    if (!Number.isSafeInteger(pollId) || pollId < 1) {
        return res.status(400).json({ error: "Invalid poll ID." });
    }

    try {
        const { data, error } = await supabase
            .from("polls")
            .select(`
                id,
                question,
                created_at,
                poll_options (
                    id,
                    option_text
                )
            `)
            .eq("id", pollId)
            .eq("is_active", true)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: "Poll not found." });
        }

        res.json(data);
    } catch (error) {
        console.error("Get poll error:", error.message);
        res.status(500).json({ error: "Unable to retrieve the poll." });
    }
});

// Create a poll with at least two options
app.post("/api/polls", async (req, res) => {
    const question =
        typeof req.body.question === "string"
            ? req.body.question.trim()
            : "";

    const rawOptions = req.body.options;

    if (!question || question.length > 200) {
        return res.status(400).json({
            error: "Question is required and must be at most 200 characters."
        });
    }

    if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
        return res.status(400).json({
            error: "Provide at least two poll options."
        });
    }

    if (rawOptions.length > 10) {
        return res.status(400).json({
            error: "A poll can have at most 10 options."
        });
    }

    if (
        rawOptions.some(
            option =>
                typeof option !== "string" ||
                option.trim().length === 0 ||
                option.trim().length > 100
        )
    ) {
        return res.status(400).json({
            error: "Each option must contain 1–100 characters."
        });
    }

    const options = rawOptions.map(option => option.trim());

    if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
        return res.status(400).json({
            error: "Poll options must be unique."
        });
    }

    try {
        const { data: poll, error: pollError } = await supabase
            .from("polls")
            .insert({ question })
            .select("id, question, created_at, is_active")
            .single();

        if (pollError) throw pollError;

        const { data: insertedOptions, error: optionsError } = await supabase
            .from("poll_options")
            .insert(
                options.map(option => ({
                    poll_id: poll.id,
                    option_text: option
                }))
            )
            .select("id, option_text");

        if (optionsError) {
            // Avoid leaving a poll without its options.
            const { error: rollbackError } = await supabase
                .from("polls")
                .delete()
                .eq("id", poll.id);

            if (rollbackError) {
                console.error("Poll cleanup error:", rollbackError.message);
            }

            throw optionsError;
        }

        res.status(201).json({
            ...poll,
            poll_options: insertedOptions
        });
    } catch (error) {
        console.error("Create poll error:", error.message);
        res.status(500).json({ error: "Unable to create the poll." });
    }
});

// Submit a vote
app.post("/api/polls/:id/vote", async (req, res) => {
    const pollId = Number(req.params.id);
    const optionId = Number(req.body.option_id);
    const voterId = req.body.voter_id;

    if (!Number.isSafeInteger(pollId) || pollId < 1) {
        return res.status(400).json({ error: "Invalid poll ID." });
    }

    if (!Number.isSafeInteger(optionId) || optionId < 1) {
        return res.status(400).json({ error: "Invalid option ID." });
    }

    if (
        typeof voterId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(voterId)
    ) {
        return res.status(400).json({
            error: "A valid voter ID is required."
        });
    }

    try {
        const { data: poll, error: pollError } = await supabase
            .from("polls")
            .select("id")
            .eq("id", pollId)
            .eq("is_active", true)
            .maybeSingle();

        if (pollError) throw pollError;

        if (!poll) {
            return res.status(404).json({
                error: "Poll not found or voting is closed."
            });
        }

        const { data: option, error: optionError } = await supabase
            .from("poll_options")
            .select("id")
            .eq("id", optionId)
            .eq("poll_id", pollId)
            .maybeSingle();

        if (optionError) throw optionError;

        if (!option) {
            return res.status(400).json({
                error: "The selected option does not belong to this poll."
            });
        }

        const { data: vote, error: voteError } = await supabase
            .from("votes")
            .insert({
                poll_id: pollId,
                option_id: optionId,
                voter_id: voterId
            })
            .select("id, poll_id, option_id, created_at")
            .single();

        if (voteError) {
            if (voteError.code === "23505") {
                return res.status(409).json({
                    error: "You have already voted in this poll."
                });
            }

            throw voteError;
        }

        res.status(201).json({
            message: "Vote submitted successfully.",
            vote
        });
    } catch (error) {
        console.error("Submit vote error:", error.message);
        res.status(500).json({ error: "Unable to submit your vote." });
    }
});

// Get poll results
app.get("/api/polls/:id/results", async (req, res) => {
    const pollId = Number(req.params.id);

    if (!Number.isSafeInteger(pollId) || pollId < 1) {
        return res.status(400).json({ error: "Invalid poll ID." });
    }

    try {
        const { data: poll, error: pollError } = await supabase
            .from("polls")
            .select(`
                id,
                question,
                poll_options (
                    id,
                    option_text
                )
            `)
            .eq("id", pollId)
            .eq("is_active", true)
            .maybeSingle();

        if (pollError) throw pollError;

        if (!poll) {
            return res.status(404).json({ error: "Poll not found." });
        }

        const { data: votes, error: votesError } = await supabase
            .from("votes")
            .select("option_id")
            .eq("poll_id", pollId);

        if (votesError) throw votesError;

        const totalVotes = votes.length;

        const options = poll.poll_options.map(option => {
            const count = votes.filter(
                vote => vote.option_id === option.id
            ).length;

            return {
                id: option.id,
                option_text: option.option_text,
                votes: count,
                percentage: totalVotes === 0
                    ? 0
                    : Math.round((count / totalVotes) * 100)
            };
        });

        res.json({
            poll_id: poll.id,
            question: poll.question,
            total_votes: totalVotes,
            options
        });
    } catch (error) {
        console.error("Get results error:", error.message);
        res.status(500).json({ error: "Unable to retrieve poll results." });
    }
});

// Handle invalid JSON
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ error: "Invalid JSON request body." });
    }

    next(error);
});

// Start server
app.listen(PORT, () => {
    console.log(`QuickVote API running at http://localhost:${PORT}`);
});