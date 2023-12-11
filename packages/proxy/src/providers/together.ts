/*
Example events:

data: {"choices":[{"text":"\n"}],"id":"83405eaa0f0a6899-SJC","token":{"id":13,"text":"\n","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":"San"}],"id":"83405eaa0f0a6899-SJC","token":{"id":17904,"text":"San","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" Francisco"}],"id":"83405eaa0f0a6899-SJC","token":{"id":9686,"text":" Francisco","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" is"}],"id":"83405eaa0f0a6899-SJC","token":{"id":349,"text":" is","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" city"}],"id":"83405eaa0f0a6899-SJC","token":{"id":2990,"text":" city","logprob":-1.1162109,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" located"}],"id":"83405eaa0f0a6899-SJC","token":{"id":5651,"text":" located","logprob":-0.4074707,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" on"}],"id":"83405eaa0f0a6899-SJC","token":{"id":356,"text":" on","logprob":-0.95458984,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" the"}],"id":"83405eaa0f0a6899-SJC","token":{"id":272,"text":" the","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" west"}],"id":"83405eaa0f0a6899-SJC","token":{"id":7635,"text":" west","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
data: {"choices":[{"text":" coast"}],"id":"83405eaa0f0a6899-SJC","token":{"id":9437,"text":" coast","logprob":0,"special":false},"generated_text":null,"details":null,"stats":null}
*/

import { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { getTimestampInSeconds } from "..";

export interface ClassicChatStreamEvent {
  choices: { text: string }[];
  id: string;
  token: { id: number; text: string; logprob: number; special: boolean };
  generated_text: string | null;
  details: string | null;
  stats: null; // Haven't seen this filled in
}

/* Example completion:

{"id":"83405e7d7f985c1b-SJC","status":"finished","prompt":["<|im_start|>user\nTell me about San Francisco<|im_end|>\n<|im_start|>assistant"],"model":"DiscoResearch/DiscoLM-mixtral-8x7b-v2","model_owner":"","num_returns":1,"args":{"model":"DiscoResearch/DiscoLM-mixtral-8x7b-v2","max_tokens":512,"prompt":"<|im_start|>user\nTell me about San
Francisco<|im_end|>\n<|im_start|>assistant","temperature":0.7,"top_p":0.7,"top_k":50,"repetition_penalty":1},"subjobs":[],"output":{"result_type":"language-model-inference","choices":[{"text":"\nSan Francisco is a city located on the west coast of the United States in the state of California. It is known for its diverse culture, beautiful
architecture, and iconic landmarks such as the Golden Gate Bridge and Alcatraz Island. The city is also home to a thriving technology industry, earning it the nickname \"Silicon Valley.\" San Francisco is a popular tourist destination, attracting millions of visitors each year who come to experience its unique blend of history, culture, an
d natural beauty.普普普くくくくくくくくくくくくくくくくくく\n\nThe city of San Francisco is a vibrant and bustling metropolis located on the western coast of the United States in the state of California. It is known for its diverse culture, stunning architecture, and iconic landmarks such as the Golden Gate Bridge, the infamous Alcatraz Is
land, and the picturesque Lombard Street. The city is also home to a thriving technology industry, earning it the nickname \"Silicon Valley.\" San Francisco's unique blend of history, culture, and natural beauty attracts millions of tourists each year.\n\nThe climate in San Francisco is mild year-round, with average temperatures ranging fr
om the mid-50s to the mid-60s Fahrenheit (approximately 12-18 degrees Celsius). The city is known for its frequent fog, which can roll in off the Pacific Ocean and cover the city in a blanket of mist.\n\nSan Francisco is a popular destination for foodies, with a diverse culinary scene that reflects the city's multicultural heritage. The ci
ty is also known for its vibrant arts and music scene, with numerous galleries, museums, and theaters showcasing the work of local and international artists.\n\nOverall, San Francisco is a fascinating and dynamic city that offers something for everyone, from its stunning natural beauty to its rich cultural heritage, vibrant arts scene, and
 thriving technology industry.普 \n\n"}]}}
 */
export interface ClassicChatCompletion {
  id: string;
  status: string;
  prompt: string[];
  model: string;
  model_owner: string;
  num_returns: number;
  args: Record<string, any>;
  subjobs: any[];
  output: {
    result_type: string;
    choices: { text: string }[];
  };
}

export function classicChatEventToOpenAIEvent(
  idx: number,
  model: string,
  event: ClassicChatStreamEvent,
): { event: ChatCompletionChunk | null; finished: boolean } {
  if (!event.choices) {
    return {
      event: null,
      finished: false,
    };
  }

  return {
    event: {
      id: event.id,
      choices: event.choices.map((choice) => ({
        delta: {
          content: idx === 0 ? choice.text.trimStart() : choice.text,
          role: "assistant",
        },
        index: 0,
        finish_reason: null /* together never sets this */,
      })),
      created: getTimestampInSeconds(),
      model,
      object: "chat.completion.chunk",
    },
    finished: false,
  };
}

export function classicChatCompletionToOpenAICompletion(
  completion: ClassicChatCompletion,
): ChatCompletion {
  return {
    id: completion.id,
    created: getTimestampInSeconds(),
    model: completion.model,
    object: "chat.completion",
    choices: completion.output.choices.map((choice) => ({
      finish_reason: "stop",
      index: 0,
      message: {
        content: choice.text.trimStart(),
        role: "assistant",
      },
    })),
  };
}
