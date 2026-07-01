#!/usr/bin/env python3
"""
Listing文案数据预处理脚本
功能：读取原始数据（关键词、竞品、产品信息），清洗、格式化，输出为结构化JSON。
"""
import argparse
import json
import csv
import os
import re
from pathlib import Path
from typing import Dict, List, Any

def clean_text(text: str) -> str:
    """清理文本：去除多余空格、换行、特殊字符"""
    if not isinstance(text, str):
        return str(text)
    # 去除前后空格
    text = text.strip()
    # 将多个空格替换为单个空格
    text = re.sub(r'\s+', ' ', text)
    # 去除控制字符
    text = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', text)
    return text

def extract_keywords(text: str) -> List[str]:
    """从文本中提取关键词（简单版，基于空格和标点分割）"""
    # 转换为小写
    text = text.lower()
    # 分割单词
    words = re.findall(r'\b[a-z]{3,}\b', text)
    # 去除常见停用词
    stopwords = {'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'not'}
    keywords = [w for w in words if w not in stopwords]
    return keywords

def process_keywords_csv(filepath: str) -> Dict[str, Any]:
    """处理关键词CSV文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    # 标准化列名
    for row in rows:
        for key in list(row.keys()):
            new_key = key.lower().strip()
            if new_key != key:
                row[new_key] = row.pop(key)
    
    # 确保必要的列存在
    required_cols = ['keyword', 'search_volume', 'competition']
    for col in required_cols:
        if col not in rows[0]:
            raise ValueError(f"关键词CSV缺少必要列: {col}")
    
    # 处理数据
    processed_rows = []
    for row in rows:
        processed = {}
        processed['keyword'] = clean_text(row['keyword'])
        processed['search_volume'] = float(row['search_volume']) if row['search_volume'] else 0
        processed['competition'] = float(row['competition']) if row['competition'] else 0.5
        if 'conversion_rate' in row:
            processed['conversion_rate'] = float(row['conversion_rate']) if row['conversion_rate'] else 0.01
        processed['opportunity_score'] = processed['search_volume'] * (1 - processed['competition'])
        processed_rows.append(processed)
    
    result = {
        'total_keywords': len(processed_rows),
        'keywords': processed_rows
    }
    return result

def process_competitors_csv(filepath: str) -> Dict[str, Any]:
    """处理竞品CSV文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    # 标准化列名
    for row in rows:
        for key in list(row.keys()):
            new_key = key.lower().strip()
            if new_key != key:
                row[new_key] = row.pop(key)
    
    competitors = []
    for row in rows:
        comp = {}
        for k, v in row.items():
            if v:  # 只保留非空值
                comp[k] = clean_text(str(v))
        competitors.append(comp)
    
    result = {
        'total_competitors': len(competitors),
        'competitors': competitors
    }
    return result

def process_product_info(filepath: str) -> Dict[str, Any]:
    """处理产品信息文件（JSON或TXT）"""
    if filepath.endswith('.json'):
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    else:
        # 假设是TXT，按行读取
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        data = {}
        current_key = None
        for line in lines:
            line = clean_text(line)
            if ':' in line:
                key, value = line.split(':', 1)
                data[key.strip().lower()] = value.strip()
                current_key = key.strip().lower()
            elif current_key:
                data[current_key] += ' ' + line
    
    # 清洗所有文本字段
    cleaned = {}
    for k, v in data.items():
        if isinstance(v, str):
            cleaned[k] = clean_text(v)
        else:
            cleaned[k] = v
    
    return cleaned

def main():
    parser = argparse.ArgumentParser(description='Listing文案数据预处理')
    parser.add_argument('--input', '-i', required=True, help='输入数据目录路径')
    parser.add_argument('--output', '-o', required=True, help='输出目录路径')
    parser.add_argument('--product-info', help='产品信息文件路径（可选）')
    args = parser.parse_args()
    
    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    processed = {}
    
    # 处理关键词数据
    keyword_files = list(input_dir.glob('*keyword*.csv')) + list(input_dir.glob('*keywords*.csv'))
    if keyword_files:
        print(f"处理关键词文件: {keyword_files[0]}")
        processed['keywords'] = process_keywords_csv(str(keyword_files[0]))
    
    # 处理竞品数据
    competitor_files = list(input_dir.glob('*competitor*.csv')) + list(input_dir.glob('*competitors*.csv'))
    if competitor_files:
        print(f"处理竞品文件: {competitor_files[0]}")
        processed['competitors'] = process_competitors_csv(str(competitor_files[0]))
    
    # 处理产品信息
    if args.product_info:
        print(f"处理产品信息: {args.product_info}")
        processed['product_info'] = process_product_info(args.product_info)
    else:
        # 尝试从输入目录找产品信息文件
        product_files = list(input_dir.glob('*product*.json')) + list(input_dir.glob('*product*.txt'))
        if product_files:
            print(f"处理产品信息: {product_files[0]}")
            processed['product_info'] = process_product_info(str(product_files[0]))
    
    # 保存处理结果
    output_file = output_dir / 'processed_data.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(processed, f, ensure_ascii=False, indent=2)
    
    print(f"数据预处理完成，结果保存至: {output_file}")
    print(f"包含模块: {list(processed.keys())}")

if __name__ == '__main__':
    main()
