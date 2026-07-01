import os
import re
import shutil

def clean_feishu_markdown(content):
    # 1. 移除飞书特有的块 ID 注释，例如 <!-- {"blockId":"xxxx"} -->
    content = re.sub(r'<!--\s*\{"blockId"[^}]*\}\s*-->', '', content)
    
    # 2. 移除一些无用的空 HTML 注释
    content = re.sub(r'<!--\s*-->', '', content)
    
    # 3. 规范化超长空白行，保证在 Obsidian 中的完美排版
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    return content.strip()

def main():
    print("=" * 50)
    print("      🚀 Feishu (飞书) 导入与格式清洗工具")
    print("=" * 50)
    
    # 输入源文件夹路径
    source_dir = input("请输入您存放飞书导出文件的本地文件夹路径:\n> ").strip()
    if not source_dir:
        print("❌ 路径不能为空！")
        return
        
    if not os.path.exists(source_dir):
        print(f"❌ 找不到指定的路径: {source_dir}")
        return

    dest_dir = r"E:\kaifa\Obsidianfiles\01_原始资料_Raw"
    os.makedirs(dest_dir, exist_ok=True)
    
    success_count = 0
    
    # 遍历源文件夹下的所有 md 文件
    for root, dirs, files in os.walk(source_dir):
        for file in files:
            if file.endswith('.md'):
                file_path = os.path.join(root, file)
                
                # 读取并清理内容
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        raw_content = f.read()
                        
                    clean_content = clean_feishu_markdown(raw_content)
                    
                    # 确定新文件名，防止重名覆盖
                    new_file_name = file
                    dest_file_path = os.path.join(dest_dir, new_file_name)
                    counter = 1
                    while os.path.exists(dest_file_path):
                        name, ext = os.path.splitext(file)
                        new_file_name = f"{name}_{counter}{ext}"
                        dest_file_path = os.path.join(dest_dir, new_file_name)
                        counter += 1
                    
                    # 写入清洗后的 Markdown 文件
                    with open(dest_file_path, 'w', encoding='utf-8') as f:
                        f.write(clean_content)
                        
                    # 同时拷贝可能存在的同名附件文件夹
                    src_asset_dir = os.path.join(root, os.path.splitext(file)[0])
                    if os.path.exists(src_asset_dir) and os.path.isdir(src_asset_dir):
                        dest_asset_dir = os.path.join(dest_dir, os.path.splitext(new_file_name)[0])
                        shutil.copytree(src_asset_dir, dest_asset_dir, dirs_exist_ok=True)
                        print(f"📎 附件文件夹已同步: {os.path.basename(dest_asset_dir)}")
                        
                    print(f"✅ 已成功导入并清洗: {file} -> {new_file_name}")
                    success_count += 1
                except Exception as e:
                    print(f"❌ 导入文件失败: {file}, 错误: {str(e)}")

    print("-" * 50)
    print(f"🎉 导入任务完成！共成功处理并导入了 {success_count} 个飞书文档。")
    print(f"📂 它们已全部整理至您的知识库原始收纳盒中：")
    print(f"   {dest_dir}")
    print("=" * 50)

if __name__ == "__main__":
    main()