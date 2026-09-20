#!/usr/bin/env python3
import os
import sys
import zipfile

def package(output_zip="extension.zip"):
    # Root files required for extension
    include_files = ["manifest.json", "options.html"]
    # Build distribution directory
    include_dirs = ["dist"]

    # Verify root files exist
    for f in include_files:
        if not os.path.exists(f):
            print(f"Error: Required file '{f}' is missing!", file=sys.stderr)
            sys.exit(1)

    # Verify dist directory exists
    for d in include_dirs:
        if not os.path.exists(d):
            print(f"Error: Required directory '{d}' is missing! Run 'npm run build' first.", file=sys.stderr)
            sys.exit(1)

    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in include_files:
            zf.write(f, f)

        for d in include_dirs:
            for root, _, files in os.walk(d):
                for file in files:
                    if file.endswith(".map"):
                        continue
                    full_path = os.path.join(root, file)
                    arcname = os.path.relpath(full_path, ".")
                    zf.write(full_path, arcname)

        if os.path.exists("images"):
            for file in sorted(os.listdir("images")):
                if file.startswith("icon") and file.endswith(".png"):
                    full_path = os.path.join("images", file)
                    zf.write(full_path, full_path)

    print(f"Package created: {output_zip} ({os.path.getsize(output_zip):,} bytes)")
    print("Contents:")
    with zipfile.ZipFile(output_zip, "r") as zf:
        for info in zf.infolist():
            print(f"  {info.filename} ({info.file_size:,} bytes)")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "extension.zip"
    package(out)
