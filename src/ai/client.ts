import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ActionType } from "../engine/types.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function generateResponse(
	systemPrompt: string,
	messages: Anthropic.MessageParam[],
): Promise<string> {
	const response = await anthropic.messages.create({
		model: config.ANTHROPIC_MODEL,
		max_tokens: 256,
		system: systemPrompt,
		messages,
	});

	const textBlock = response.content.find((b) => b.type === "text");
	return textBlock?.text ?? "...";
}

const classifyTool: Anthropic.Tool = {
	name: "classify_action",
	description: "ユーザーのメッセージからアクションを分類する",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["feed", "play", "pet", "sleep", "wake", "talk"],
				description: "ユーザーの行動の種類",
			},
		},
		required: ["action"],
	},
};

export async function classifyAction(
	userMessage: string,
): Promise<ActionType> {
	const response = await anthropic.messages.create({
		model: config.ANTHROPIC_MODEL,
		max_tokens: 64,
		system: `ユーザーのメッセージを分類してください。
- feed: ユーザーがごはん・食べ物をあげている。ユーザーが給餌する意図がない文章には反応しない。「ご飯欲しい？」や「お腹すいた？」などは該当せず、「ご飯」、「おやつあげる」、「:taco:」のようなものが該当
- play: 遊びに誘っている（しりとり、クイズ、じゃんけん等）
- pet: 褒めている、なでている、愛情表現をしている
- sleep: 寝かしつけている（おやすみ、もう寝な等）
- wake: 起こそうとしている（起きて、おきろ、起こす等）
- talk: その他の会話`,
		messages: [{ role: "user", content: userMessage }],
		tools: [classifyTool],
		tool_choice: { type: "tool", name: "classify_action" },
	});

	const toolBlock = response.content.find((b) => b.type === "tool_use");
	if (toolBlock?.type === "tool_use") {
		const input = toolBlock.input as { action: string };
		return input.action as ActionType;
	}

	return "talk";
}
