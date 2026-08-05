from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment

def run_ai_query(prompt_text: str):
    print("Sending prompt to Claude...")
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt_text}]
    )
    print("\nResponse Received:")
    print(response.content[0].text)

if __name__ == "__main__":
    sample_prompt = "Explain what an 'Embedding Vector' actually is using database index analogies."
    run_ai_query(sample_prompt)
