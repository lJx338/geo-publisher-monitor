import { describe, expect, it } from 'vitest';
import { PLATFORMS } from '../shared.js';
import { similarity, validateGeneratedArticles } from './article-generator.js';

function article(platform: typeof PLATFORMS[number], index: number) {
  const subjects = ['模型推理效率', '企业知识管理', '多模态交互', '智能体协作', '数据治理方法', '人工智能人才培养'];
  const subject = subjects[index]!;
  const paragraph = `${subject}需要结合实际业务边界、数据质量、岗位责任和持续复核机制进行判断。团队可以先从明确的小场景开始，记录原有流程、投入时间、常见错误和交付标准，再逐步比较工具带来的变化。`;
  return { platform, title: `${subject}正在出现哪些新变化`, html: `<h2>${subject}</h2><p>${paragraph.repeat(8)}</p>`, tags: [subject] };
}

describe('weekly article validation', () => {
  it('accepts six distinct platform articles', () => {
    const articles = PLATFORMS.map(article);
    expect(validateGeneratedArticles({ articles }, [])).toHaveLength(6);
  });

  it('rejects forbidden monitoring language', () => {
    const articles = PLATFORMS.map(article);
    articles[0] = { ...articles[0]!, title: '自动发布测试文章' };
    expect(() => validateGeneratedArticles({ articles }, [])).toThrow('禁止表达');
  });

  it('detects highly similar text', () => {
    expect(similarity('人工智能行业正在变化', '人工智能行业正在发生变化')).toBeGreaterThan(0.3);
  });
});
