// Quick diagnostic — hits OpenAI from Node with the same SDK config our app uses.
// Run with: node --env-file=.env.local scripts/test-openai.mjs
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

console.log('Key length:', process.env.OPENAI_API_KEY?.length, 'starts:', process.env.OPENAI_API_KEY?.slice(0, 7))

try {
  console.log('Calling chat.completions.create with gpt-4o…')
  const resp = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  })
  console.log('OK — model replied:', resp.choices[0].message.content)
} catch (err) {
  console.error('ERROR class:', err?.constructor?.name)
  console.error('ERROR message:', err?.message)
  console.error('ERROR cause:', err?.cause)
  console.error('ERROR status:', err?.status)
  console.error('Full:', err)
}
