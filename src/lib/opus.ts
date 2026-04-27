export async function callOpus(prompt: string): Promise<string> {
    const res = await fetch("http://localhost:3001/opus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
      cache: "no-store",
    });
  
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Opus request failed: ${res.status} ${errorText}`);
    }
  
    const data = await res.json();
  
    if (!data?.result) {
      throw new Error("Opus returned empty result");
    }
  
    return data.result;
  }