import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { PLATFORMS, type Platform, type WeeklyArticle } from '../shared.js';
import { generateCover } from './cover-generator.js';

const generatedArticleSchema = z.object({
  platform: z.enum(PLATFORMS),
  title: z.string().trim().min(8).max(30),
  html: z.string().min(600),
  tags: z.array(z.string().trim().min(1).max(12)).max(5).default([]),
});

const responseSchema = z.object({ articles: z.array(generatedArticleSchema).length(6) });
const forbidden = /测试|巡检|自动发布|保证|百分百|唯一最好|快速赚钱|占位符|待补充|TODO/i;

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(value: string): Set<string> {
  const compact = plainText(value).replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = new Set<string>();
  for (let index = 0; index < compact.length - 2; index += 2) tokens.add(compact.slice(index, index + 3));
  return tokens;
}

export function similarity(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function validateGeneratedArticles(raw: unknown, previousTitles: string[]): Array<z.infer<typeof generatedArticleSchema>> {
  const parsed = responseSchema.parse(raw).articles;
  const platforms = new Set(parsed.map((item) => item.platform));
  if (platforms.size !== PLATFORMS.length) throw new Error('模型没有为六个平台分别生成文章');
  for (const article of parsed) {
    const text = plainText(article.html);
    if (forbidden.test(`${article.title} ${text}`)) throw new Error(`${article.platform} 文章包含禁止表达`);
    if (text.length < 600 || text.length > 2600) throw new Error(`${article.platform} 文章字数不在 600-2600 范围内`);
    if (!/<p[ >]|<h2[ >]|<h3[ >]/i.test(article.html)) throw new Error(`${article.platform} 文章缺少有效 HTML 结构`);
    if (previousTitles.some((title) => similarity(article.title, title) > 0.72)) throw new Error(`${article.platform} 选题与90天历史重复`);
  }
  for (let left = 0; left < parsed.length; left += 1) {
    for (let right = left + 1; right < parsed.length; right += 1) {
      if (similarity(parsed[left]!.html, parsed[right]!.html) > 0.82) throw new Error('本周六篇文章内容相似度过高');
    }
  }
  return parsed;
}

function extractJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced || value).trim());
}

export async function generateWeeklyArticles(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  previousTitles: string[];
  outputDirectory: string;
}): Promise<WeeklyArticle[]> {
  if (!options.baseUrl || !options.apiKey || !options.model) throw new Error('请先配置 OpenAI 兼容接口、API Key 和模型名');
  const prompt = `你是AI行业资深编辑。请为百家号、头条号、知乎、企鹅号、搜狐号、网易号分别生成一篇独立的中文AI行业文章。
要求：六个选题和论述必须不同；内容正常、客观、有实际信息；不得出现测试、巡检、自动发布；不得虚构公司、数据、研究报告或来源；不得使用保证、百分百、唯一最好、快速赚钱；正文600-2600字；HTML仅使用h2、h3、p、ul、li、strong；标题8-30字。
历史标题，必须避开：${JSON.stringify(options.previousTitles.slice(-100))}
只输出JSON：{"articles":[{"platform":"baijia|toutiao|zhihu|penguin|sohu|netease","title":"...","html":"...","tags":["..."]}]}`;
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model, temperature: 0.8, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型接口没有返回文章内容');
  const generated = validateGeneratedArticles(extractJson(content), options.previousTitles);
  const coverDirectory = join(options.outputDirectory, 'covers');
  const articles: WeeklyArticle[] = [];
  for (const [index, item] of generated.entries()) {
    const coverPath = await generateCover(coverDirectory, item.platform, item.title, index);
    articles.push({
      ...item,
      coverPath,
      contentHash: createHash('sha256').update(`${item.title}\n${item.html}`).digest('hex'),
    });
  }
  return articles;
}
