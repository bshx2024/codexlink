#!/usr/bin/env python3
"""
关键词分析与聚类脚本
功能：分析关键词数据，生成关键词矩阵，识别核心词、长尾词、语义集群。
"""
import argparse
import json
from pathlib import Path
from collections import defaultdict
import math

def calculate_keyword_metrics(keywords_data: list) -> list:
    """计算关键词各项指标"""
    processed = []
    for item in keywords_data:
        processed_item = item.copy()
        # 确保数值类型
        processed_item['search_volume'] = float(item.get('search_volume', 0))
        processed_item['competition'] = float(item.get('competition', 0.5))
        
        # 计算机会分数
        processed_item['opportunity_score'] = processed_item['search_volume'] * (1 - processed_item['competition'])
        
        # 计算优先级分数
        if 'conversion_rate' in item:
            processed_item['conversion_rate'] = float(item.get('conversion_rate', 0.01))
            processed_item['priority_score'] = processed_item['search_volume'] * processed_item['conversion_rate'] * (1 - processed_item['competition'])
        else:
            processed_item['priority_score'] = processed_item['opportunity_score']
        
        # 关键词长度
        processed_item['word_count'] = len(str(item.get('keyword', '')).split())
        
        processed.append(processed_item)
    
    return processed

def cluster_keywords_by_semantics(keywords: list) -> dict:
    """基于语义相似度聚类关键词（简化版，基于词干和共同词）"""
    clusters = defaultdict(list)
    
    for item in keywords:
        keyword = str(item.get('keyword', '')).lower()
        words = keyword.split()
        if len(words) >= 2:
            cluster_key = ' '.join(words[:2])
        else:
            cluster_key = keyword
        
        clusters[cluster_key].append({
            'keyword': keyword,
            'search_volume': item['search_volume'],
            'competition': item['competition'],
            'opportunity_score': item['opportunity_score']
        })
    
    # 对每个簇内的关键词按机会分数排序
    for key in clusters:
        clusters[key] = sorted(clusters[key], key=lambda x: x['opportunity_score'], reverse=True)
    
    return dict(clusters)

def generate_keyword_matrix(keywords: list, clusters: dict) -> dict:
    """生成关键词矩阵"""
    # 按优先级分数排序
    sorted_by_priority = sorted(keywords, key=lambda x: x.get('priority_score', 0), reverse=True)
    sorted_by_opportunity = sorted(keywords, key=lambda x: x.get('opportunity_score', 0), reverse=True)
    
    # 分类
    core_keywords = [k for k in keywords if k.get('word_count', 0) <= 2]
    long_tail_keywords = [k for k in keywords if k.get('word_count', 0) > 2]
    
    # 按优先级排序
    core_keywords_sorted = sorted(core_keywords, key=lambda x: x.get('priority_score', 0), reverse=True)
    long_tail_sorted = sorted(long_tail_keywords, key=lambda x: x.get('priority_score', 0), reverse=True)
    
    # 计算高机会关键词阈值（前25%）
    opportunity_scores = [k.get('opportunity_score', 0) for k in keywords]
    if opportunity_scores:
        threshold_75 = sorted(opportunity_scores)[int(len(opportunity_scores) * 0.75)]
        high_opportunity = [k for k in keywords if k.get('opportunity_score', 0) > threshold_75]
    else:
        high_opportunity = []
    
    # 低竞争关键词（竞争度<0.3）
    low_competition = [k for k in keywords if k.get('competition', 1) < 0.3]
    
    matrix = {
        'summary': {
            'total_keywords': len(keywords),
            'core_keywords': len(core_keywords),
            'long_tail_keywords': len(long_tail_keywords),
            'high_opportunity_keywords': len(high_opportunity),
            'low_competition_keywords': len(low_competition)
        },
        'categories': {
            'core_keywords': core_keywords_sorted[:20],
            'long_tail_keywords': long_tail_sorted[:30],
            'high_opportunity': sorted(high_opportunity, key=lambda x: x.get('opportunity_score', 0), reverse=True)[:15],
            'low_competition': sorted(low_competition, key=lambda x: x.get('priority_score', 0), reverse=True)[:15]
        },
        'semantic_clusters': clusters,
        'recommended布局': {
            'title_keywords': [k.get('keyword', '') for k in sorted_by_priority[:5]],
            'bullet_keywords': [k.get('keyword', '') for k in sorted_by_priority[:15]],
            'description_keywords': [k.get('keyword', '') for k in sorted_by_priority[:25]],
            'backend_keywords': [k.get('keyword', '') for k in sorted_by_opportunity if k.get('competition', 1) < 0.4 and k.get('search_volume', 0) > 100][:20]
        }
    }
    
    return matrix

def main():
    parser = argparse.ArgumentParser(description='关键词分析与聚类')
    parser.add_argument('--input', '-i', required=True, help='处理后的数据文件路径（JSON）')
    parser.add_argument('--output', '-o', required=True, help='输出关键词矩阵路径')
    args = parser.parse_args()
    
    # 读取处理后的数据
    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if 'keywords' not in data or 'keywords' not in data['keywords']:
        print("错误：输入数据中没有找到关键词数据")
        return
    
    keywords_data = data['keywords']['keywords']
    print(f"加载了 {len(keywords_data)} 个关键词")
    
    # 计算关键词指标
    processed_keywords = calculate_keyword_metrics(keywords_data)
    
    # 语义聚类
    clusters = cluster_keywords_by_semantics(processed_keywords)
    print(f"生成了 {len(clusters)} 个语义簇")
    
    # 生成关键词矩阵
    matrix = generate_keyword_matrix(processed_keywords, clusters)
    
    # 保存结果
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(matrix, f, ensure_ascii=False, indent=2)
    
    print(f"关键词矩阵已保存至: {output_path}")
    
    # 输出摘要
    print("\n=== 关键词分析摘要 ===")
    print(f"总关键词数: {matrix['summary']['total_keywords']}")
    print(f"核心关键词: {matrix['summary']['core_keywords']}")
    print(f"长尾关键词: {matrix['summary']['long_tail_keywords']}")
    print(f"高机会关键词: {matrix['summary']['high_opportunity_keywords']}")
    print(f"低竞争关键词: {matrix['summary']['low_competition_keywords']}")
    print(f"\n推荐标题关键词: {', '.join(matrix['recommended布局']['title_keywords'][:5])}")
    print(f"推荐五点关键词: {', '.join(matrix['recommended布局']['bullet_keywords'][:5])}...")

if __name__ == '__main__':
    main()
