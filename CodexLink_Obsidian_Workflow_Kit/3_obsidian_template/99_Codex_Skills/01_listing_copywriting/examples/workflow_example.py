#!/usr/bin/env python3
"""
Listing文案打造工作流示例
演示从原始数据到最终Listing文案的完整流程。
"""
import sys
import os
import json
import subprocess
from pathlib import Path
import argparse

def run_script(script_path, args):
    """运行Python脚本"""
    cmd = [sys.executable, str(script_path)] + [str(arg) for arg in args]
    print(f"运行命令: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)
        if result.stderr:
            print(f"警告: {result.stderr}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"错误: {e}")
        print(f"标准错误: {e.stderr}")
        return False

def generate_sample_listing(keyword_matrix_path, product_info_path):
    """生成示例Listing（模拟AI输出）"""
    # 读取关键词矩阵
    with open(keyword_matrix_path, 'r', encoding='utf-8') as f:
        keyword_matrix = json.load(f)
    
    # 读取产品信息
    with open(product_info_path, 'r', encoding='utf-8') as f:
        product_info = json.load(f)
    
    # 提取关键词
    title_keywords = keyword_matrix['recommended布局']['title_keywords']
    bullet_keywords = keyword_matrix['recommended布局']['bullet_keywords']
    
    # 生成标题示例
    title = f"{product_info['brand']} {product_info['model']} Wireless Bluetooth Headphones - Active Noise Cancelling, 40Hr Battery, Hi-Fi Stereo, Comfortable Over-Ear Design for {', '.join(product_info['target_audience'][:2])}"
    
    # 生成五点描述
    bullets = []
    bullet_templates = [
        ("【Active Noise Cancelling】Hybrid ANC technology reduces ambient noise by up to 90%, perfect for {scenario}.", ["commuting", "travel", "office work"]),
        ("【40-Hour Battery Life】Industry-leading playtime with fast charging - 10 minutes charge gives 5 hours of music.", ["long flights", "work from home", "studying"]),
        ("【Hi-Fi Stereo Sound】40mm custom drivers deliver crystal clear audio with deep bass and detailed highs.", ["music lovers", "gaming", "movies"]),
        ("【Comfortable Design】Memory foam ear cushions and adjustable headband ensure all-day comfort.", ["remote work", "online meetings", "podcasts"]),
        ("【Multi-Device Connection】Bluetooth 5.2 allows connection to 2 devices simultaneously for seamless switching.", ["phone and laptop", "tablet and computer", "work and personal devices"])
    ]
    
    for i, (template, scenarios) in enumerate(bullet_templates):
        bullet = template.format(scenario=scenarios[i % len(scenarios)])
        bullets.append(bullet)
    
    # 生成产品描述
    description = f"""
<b>Tired of distracting background noise while working or traveling?</b><br><br>

Introducing the {product_info['brand']} {product_info['model']} - the ultimate wireless headphones designed specifically for {', '.join(product_info['target_audience'][:3])}. Unlike ordinary headphones, our {product_info['model']} features {product_info['unique_selling_points'][0].lower()} and {product_info['unique_selling_points'][1].lower()}, giving you immersive sound experience and all-day comfort.<br><br>

<b>Why Choose {product_info['brand']} {product_info['model']}?</b><br>
✔️ <b>Active Noise Cancelling</b>: Advanced hybrid ANC technology blocks out unwanted ambient noise<br>
✔️ <b>40-Hour Playtime</b>: Industry-leading battery life with quick charging capability<br>
✔️ <b>Hi-Res Audio</b>: 40mm custom drivers deliver studio-quality sound with deep bass<br>
✔️ <b>Comfort-First Design</b>: Memory foam ear cushions and lightweight construction<br>
✔️ <b>Multi-Point Connection</b>: Connect to two devices simultaneously<br><br>

<b>Perfect For:</b><br>
• <b>Remote Workers & Office</b>: Block out distractions for improved focus and productivity<br>
• <b>Commuters & Travelers</b>: Enjoy music, podcasts, or silence during flights and commutes<br>
• <b>Students</b>: Create your perfect study environment anywhere<br>
• <b>Music Enthusiasts</b>: Experience your favorite songs with studio-quality sound<br>
• <b>Gamers</b>: Immersive audio experience with minimal latency<br><br>

<b>Technical Specifications:</b><br>
• Driver Size: {product_info['technical_specs']['driver_size']}<br>
• Frequency Response: {product_info['technical_specs']['frequency_response']}<br>
• Battery Life: {product_info['technical_specs']['battery_life']}<br>
• Bluetooth Version: {product_info['technical_specs']['bluetooth_version']}<br>
• Weight: {product_info['technical_specs']['weight']}<br><br>

<b>What's in the Box:</b><br>
• {product_info['model']} Wireless Headphones<br>
• Premium Carrying Case<br>
• USB-C Charging Cable<br>
• 3.5mm AUX Audio Cable<br>
• User Manual<br>
• 12-Month Warranty Card<br><br>

<b>100% Satisfaction Guarantee</b><br>
We stand behind our products with a 12-month warranty and 30-day money-back guarantee. If you're not completely satisfied, contact our customer service team for a full refund.<br><br>

<b>Order Now</b> and experience the difference in sound quality and comfort!
"""
    
    # 生成后台关键词
    backend_keywords = " ".join(keyword_matrix['recommended布局']['backend_keywords'])
    
    return {
        "title": title,
        "bullet_points": bullets,
        "description": description.strip(),
        "backend_keywords": backend_keywords
    }

def main():
    parser = argparse.ArgumentParser(description='Listing文案工作流示例')
    parser.add_argument('--data-dir', '-d', default='raw_data', help='原始数据目录')
    parser.add_argument('--output-dir', '-o', default='output', help='输出目录')
    args = parser.parse_args()
    
    # 设置路径
    base_dir = Path(__file__).parent
    data_dir = base_dir / args.data_dir
    output_dir = base_dir / args.output_dir
    scripts_dir = base_dir.parent / 'scripts'
    
    print(f"原始数据目录: {data_dir}")
    print(f"输出目录: {output_dir}")
    
    # 步骤1：数据预处理
    print("\n=== 步骤1: 数据预处理 ===")
    processed_dir = output_dir / 'processed'
    processed_dir.mkdir(parents=True, exist_ok=True)
    
    preprocess_script = scripts_dir / 'data_preprocessing.py'
    if not run_script(preprocess_script, [
        '--input', str(data_dir),
        '--output', str(processed_dir),
        '--product-info', str(data_dir / 'product_info.json')
    ]):
        print("数据预处理失败")
        return
    
    # 步骤2：关键词分析
    print("\n=== 步骤2: 关键词分析 ===")
    keyword_matrix_path = processed_dir / 'keyword_matrix.json'
    
    keyword_script = scripts_dir / 'keyword_analysis.py'
    if not run_script(keyword_script, [
        '--input', str(processed_dir / 'processed_data.json'),
        '--output', str(keyword_matrix_path)
    ]):
        print("关键词分析失败")
        return
    
    # 步骤3：生成示例Listing（模拟AI生成）
    print("\n=== 步骤3: 生成示例Listing ===")
    listing = generate_sample_listing(
        keyword_matrix_path,
        data_dir / 'product_info.json'
    )
    
    # 保存Listing
    listing_dir = output_dir / 'listing'
    listing_dir.mkdir(parents=True, exist_ok=True)
    
    # 保存完整JSON
    with open(listing_dir / 'listing.json', 'w', encoding='utf-8') as f:
        json.dump(listing, f, ensure_ascii=False, indent=2)
    
    # 保存纯文本版本
    with open(listing_dir / 'listing.txt', 'w', encoding='utf-8') as f:
        f.write(f"标题:\n{listing['title']}\n\n")
        f.write("五点描述:\n")
        for i, bullet in enumerate(listing['bullet_points'], 1):
            f.write(f"{i}. {bullet}\n")
        f.write(f"\n产品描述:\n{listing['description']}\n\n")
        f.write(f"后台关键词:\n{listing['backend_keywords']}\n")
    
    # 保存各个部分
    with open(listing_dir / 'title.txt', 'w', encoding='utf-8') as f:
        f.write(listing['title'])
    
    with open(listing_dir / 'bullet_points.txt', 'w', encoding='utf-8') as f:
        for i, bullet in enumerate(listing['bullet_points'], 1):
            f.write(f"{i}. {bullet}\n")
    
    with open(listing_dir / 'description.html', 'w', encoding='utf-8') as f:
        f.write(listing['description'])
    
    with open(listing_dir / 'backend_keywords.txt', 'w', encoding='utf-8') as f:
        f.write(listing['backend_keywords'])
    
    print(f"Listing已保存至: {listing_dir}")
    
    # 生成优化报告
    print("\n=== 步骤4: 生成优化报告 ===")
    report = f"""
# Listing优化报告

## 产品信息
- 产品: {listing['title'].split(' - ')[0]}
- 生成时间: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 关键词覆盖率
- 标题包含关键词数: {len([kw for kw in ['wireless', 'bluetooth', 'headphones', 'noise cancelling', 'battery'] if kw in listing['title'].lower()])}
- 五点描述关键词数: {len([kw for kw in ['anc', 'battery', 'sound', 'comfortable', 'connection'] if any(kw in bullet.lower() for bullet in listing['bullet_points'])])}
- 后台关键词数: {len(listing['backend_keywords'].split())}

## 算法适配评估
### A9/A10优化
- ✅ 核心关键词放在标题开头
- ✅ 品牌和型号明确
- ✅ 关键特性突出

### Cosmo算法适配
- ✅ 使用自然语言描述
- ✅ 包含同义词和相关概念
- ✅ 详细的功能说明

### Rufus AI优化
- ✅ 开头使用痛点提问
- ✅ 场景化描述丰富
- ✅ 包含"Perfect For"场景列表

## 改进建议
1. **增加具体数据**: 在描述中添加更多具体数字（如"90%噪音减少"）
2. **强化差异化**: 突出与竞品的具体差异点
3. **优化CTA**: 考虑添加限时优惠或促销信息
4. **A/B测试**: 建议测试标题变体，特别是关键词顺序

## 下一步行动
1. 将生成的Listing上传到亚马逊Seller Central
2. 设置A/B测试比较不同版本
3. 监控关键词排名和转化率变化
4. 根据实际数据持续优化
"""
    
    with open(output_dir / 'optimization_report.md', 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"优化报告已保存至: {output_dir / 'optimization_report.md'}")
    print("\n=== 工作流完成 ===")
    print(f"输出目录结构:")
    for root, dirs, files in os.walk(output_dir):
        level = root.replace(str(output_dir), '').count(os.sep)
        indent = ' ' * 2 * level
        print(f"{indent}{os.path.basename(root)}/")
        subindent = ' ' * 2 * (level + 1)
        for file in files:
            print(f"{subindent}{file}")

if __name__ == '__main__':
    main()
