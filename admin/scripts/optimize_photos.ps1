<#
.SYNOPSIS
    All-in-one photo optimizer and metadata scanner for hill photos.

.DESCRIPTION
    A single, unified PowerShell script to process, optimize, and organize summit photos:

    1. Resizing & Web Optimization (1600x900 Center-Crop):
       - Scans the directory for image files (.jpg, .jpeg, and .png).
       - Any photo that is NOT already 1600x900 (e.g. high-resolution camera originals):
           * Preserves existing comments, titles, and tags/keywords prior to modification.
           * Automatically corrects EXIF camera orientation (upright orientation).
           * Intelligently calculates a 16:9 aspect ratio bounding box centered on the frame.
           * Resamples and scales down to 1600x900 using high-quality bicubic interpolation.
           * Compresses to web-friendly JPEG format (default quality: 85).
           * Writes back original comments, titles, and tag metadata onto the optimized file.
       - Any photo that is ALREADY 1600x900 is skipped for resizing to save processing time and prevent recompression artifacts.

    2. Tags / Multi-Hill Linking Support:
       - Reads the Windows Explorer "Tags" metadata field (EXIF XPKeywords, IPTC, and XMP).
       - If you enter hill numbers into the Tags field (e.g. separated by spaces or commas),
         the photo will be linked to ALL of those hills in addition to the number in the filename.
       - Example: A photo named 196_001.jpg with Tag "209" will appear under Hill 196 AND under Hill 209!

    3. Priority Display Ordering:
       - Photos where the filename begins with the hill number are displayed FIRST,
         ordered by their numeric suffix (_001, _002, etc.).
       - Photos linked via Tags (e.g. background summits captured in the distance) are displayed AFTERWARDS.

    4. Comments & photos.json Synchronization:
       - Scans all photos to read current comment/title metadata (Windows Explorer Comments field,
         XPTitle, or EXIF ImageDescription).
       - Compares the scanned state against photos.json.
       - If new photos were added, or if comments or tags were added or edited on existing photos,
         automatically updates photos.json with the latest information (UTF-8 without BOM).

    5. Interactive Terminal Pause:
       - When launched by double-clicking the .ps1 file in Windows Explorer, keeps the terminal
         window open after completion or on error, so you can review results before closing.

.PARAMETER Folder
    The directory containing hill photos. Defaults to the folder containing this script ($PSScriptRoot).

.PARAMETER Quality
    JPEG compression quality percentage (1-100, default: 85).

.PARAMETER TargetWidth
    Target width in pixels for web display (default: 1600).

.PARAMETER TargetHeight
    Target height in pixels for web display (default: 900).

.PARAMETER BackupOriginals
    Optional switch to copy unoptimized originals into an 'originals' subfolder before resizing.

.PARAMETER Force
    Optional switch to force re-resizing of images even if they are already 1600x900.

.PARAMETER NoPause
    Optional switch to suppress the exit pause prompt (useful for headless automated scripts).
#>

[CmdletBinding()]
param (
    [string]$Folder = "",
    [int]$Quality = 85,
    [int]$TargetWidth = 1600,
    [int]$TargetHeight = 900,
    [switch]$BackupOriginals,
    [switch]$Force,
    [switch]$NoPause
)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

# If no Folder specified, default to image/hills, script root, or current working directory
if ([string]::IsNullOrWhiteSpace($Folder)) {
    $candidate = Join-Path $PSScriptRoot "..\..\image\hills"
    if (Test-Path $candidate) {
        $Folder = (Resolve-Path $candidate).Path
    } else {
        $Folder = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    }
}

# -----------------------------------------------------------------------------
# Interactive Exit Helper
# Keeps console open so user can inspect output when run via double-click
# -----------------------------------------------------------------------------
function Wait-Exit {
    param([string]$Message = "Press any key to exit...")
    if (-not $NoPause -and -not [Console]::IsInputRedirected) {
        Write-Host ""
        Write-Host $Message -ForegroundColor Cyan
        try {
            [void][System.Console]::ReadKey($true)
        } catch {
            Read-Host
        }
    }
}

try {
    # Validate target directory
    if (-not (Test-Path -Path $Folder)) {
        Write-Error "Folder not found: $Folder"
        return
    }

    # Load required .NET assemblies for imaging:
    # - System.Drawing: High-performance GDI+ graphics for bicubic resampling and orientation.
    # - PresentationCore & WindowsBase: Windows Imaging Component (WIC) for EXIF XPComment & XPKeywords.
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName PresentationCore, WindowsBase -ErrorAction SilentlyContinue

    # -------------------------------------------------------------------------
    # Helper: Extract Comment / Title Metadata
    # Checks Windows Explorer "Comments" field, XPTitle, and standard EXIF fields
    # -------------------------------------------------------------------------
    function Get-ImageComment {
        param([string]$FilePath)
        $title = ""
        try {
            $bytes = [System.IO.File]::ReadAllBytes($FilePath)
            $ms = [System.IO.MemoryStream]::new($bytes)
            $img = [System.Drawing.Image]::FromStream($ms)

            # 1. Windows Explorer "Comments" field (XPComment: 0x9C9C, UTF-16LE)
            $prop = $img.PropertyItems | Where-Object { $_.Id -eq 0x9C9C } | Select-Object -First 1
            if ($prop -and $prop.Value) {
                $val = [System.Text.Encoding]::Unicode.GetString($prop.Value).Trim([char]0).Trim()
                if ($val) { $title = $val }
            }

            # 2. Windows Explorer "Title" field (XPTitle: 0x9C9B, UTF-16LE)
            if (-not $title) {
                $prop = $img.PropertyItems | Where-Object { $_.Id -eq 0x9C9B } | Select-Object -First 1
                if ($prop -and $prop.Value) {
                    $val = [System.Text.Encoding]::Unicode.GetString($prop.Value).Trim([char]0).Trim()
                    if ($val) { $title = $val }
                }
            }

            # 3. EXIF Image Description (0x010E, UTF-8)
            if (-not $title) {
                $prop = $img.PropertyItems | Where-Object { $_.Id -eq 0x010E } | Select-Object -First 1
                if ($prop -and $prop.Value) {
                    $val = [System.Text.Encoding]::UTF8.GetString($prop.Value).Trim([char]0).Trim()
                    if ($val) { $title = $val }
                }
            }

            # 4. EXIF UserComment (0x9286, Unicode or UTF-8)
            if (-not $title) {
                $prop = $img.PropertyItems | Where-Object { $_.Id -eq 0x9286 } | Select-Object -First 1
                if ($prop -and $prop.Value) {
                    if ($prop.Value.Length -gt 8) {
                        $prefix = [System.Text.Encoding]::ASCII.GetString($prop.Value, 0, 8)
                        if ($prefix.StartsWith("UNICODE")) {
                            $val = [System.Text.Encoding]::Unicode.GetString($prop.Value, 8, $prop.Value.Length - 8).Trim([char]0).Trim()
                        } else {
                            $val = [System.Text.Encoding]::UTF8.GetString($prop.Value, 8, $prop.Value.Length - 8).Trim([char]0).Trim()
                        }
                    } else {
                        $val = [System.Text.Encoding]::UTF8.GetString($prop.Value).Trim([char]0).Trim()
                    }
                    if ($val) { $title = $val }
                }
            }

            $img.Dispose()
            $ms.Dispose()
        } catch {}

        # 5. WPF / WIC BitmapMetadata fallback
        if (-not $title) {
            try {
                $inStream = [System.IO.File]::OpenRead($FilePath)
                $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($inStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
                $frame = $decoder.Frames[0]
                $meta = $frame.Metadata -as [System.Windows.Media.Imaging.BitmapMetadata]
                if ($meta) {
                    if ($meta.Comment) { $title = $meta.Comment.Trim() }
                    elseif ($meta.Title) { $title = $meta.Title.Trim() }
                }
                $inStream.Close()
            } catch {}
        }

        return $title
    }

    # -------------------------------------------------------------------------
    # Helper: Extract Tags / Keywords Metadata
    # Reads Windows Explorer "Tags" (XPKeywords 0x9C9D, IPTC, and XMP)
    # Extracts primary, secondary, and from hill associations
    # -------------------------------------------------------------------------
    function Get-ImageTags {
        param([string]$FilePath)
        $rawTags = [System.Collections.Generic.List[string]]::new()

        # 1. Try WPF / WIC BitmapMetadata (reads EXIF XPKeywords, IPTC keywords, and XMP tags)
        try {
            $inStream = [System.IO.File]::OpenRead($FilePath)
            $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($inStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
            $frame = $decoder.Frames[0]
            $meta = $frame.Metadata -as [System.Windows.Media.Imaging.BitmapMetadata]
            if ($meta -and $meta.Keywords) {
                foreach ($kw in $meta.Keywords) {
                    if ($kw) { $rawTags.Add($kw) }
                }
            }
            $inStream.Close()
        } catch {}

        # 2. Try GDI+ XPKeywords (0x9C9D, UTF-16LE)
        try {
            $bytes = [System.IO.File]::ReadAllBytes($FilePath)
            $ms = [System.IO.MemoryStream]::new($bytes)
            $img = [System.Drawing.Image]::FromStream($ms)
            $prop = $img.PropertyItems | Where-Object { $_.Id -eq 0x9C9D } | Select-Object -First 1
            if ($prop -and $prop.Value) {
                $val = [System.Text.Encoding]::Unicode.GetString($prop.Value).Trim([char]0).Trim()
                if ($val) { $rawTags.Add($val) }
            }
            $img.Dispose()
            $ms.Dispose()
        } catch {}

        $primary = [System.Collections.Generic.List[string]]::new()
        $secondary = [System.Collections.Generic.List[string]]::new()
        $from = [System.Collections.Generic.List[string]]::new()
        $all = [System.Collections.Generic.List[string]]::new()

        foreach ($raw in $rawTags) {
            $parts = $raw -split '[,;]+' | Where-Object { $_.Trim() }
            foreach ($p in $parts) {
                $t = $p.Trim()
                if ($t -match '^primary:(.+)$') {
                    foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                        if (-not $primary.Contains($h)) { $primary.Add($h) }
                        if (-not $all.Contains($h)) { $all.Add($h) }
                    }
                } elseif ($t -match '^secondary:(.+)$') {
                    foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                        if (-not $secondary.Contains($h)) { $secondary.Add($h) }
                        if (-not $all.Contains($h)) { $all.Add($h) }
                    }
                } elseif ($t -match '^from:(.+)$') {
                    foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                        if (-not $from.Contains($h)) { $from.Add($h) }
                        if (-not $all.Contains($h)) { $all.Add($h) }
                    }
                } elseif ($t -match '^\d+$') {
                    if (-not $secondary.Contains($t)) { $secondary.Add($t) }
                    if (-not $all.Contains($t)) { $all.Add($t) }
                }
            }
        }

        return [PSCustomObject]@{
            Primary = @($primary)
            Secondary = @($secondary)
            From = @($from)
            All = @($all)
            Raw = @($rawTags)
        }
    }

    # -------------------------------------------------------------------------
    # Helper: Write Comment and Tag Metadata onto a JPEG
    # Uses WPF JpegBitmapEncoder to persist metadata onto newly resized images
    # -------------------------------------------------------------------------
    function Set-JpegMetadata {
        param(
            [string]$FilePath,
            [string]$Comment,
            [string[]]$Keywords
        )
        if (-not $Comment -and (-not $Keywords -or $Keywords.Count -eq 0)) { return }
        try {
            $tempMeta = "$FilePath.meta.tmp"
            $inStream = [System.IO.File]::OpenRead($FilePath)
            $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($inStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
            $frame = $decoder.Frames[0]
            $metadata = $frame.Metadata.Clone() -as [System.Windows.Media.Imaging.BitmapMetadata]
            if (-not $metadata) { $metadata = [System.Windows.Media.Imaging.BitmapMetadata]::new("jpg") }

            if ($Comment) {
                $metadata.Comment = $Comment
                try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40092}", $Comment) } catch {}
            }
            if ($Keywords -and $Keywords.Count -gt 0) {
                $kwColl = [System.Collections.ObjectModel.ReadOnlyCollection[string]]::new($Keywords)
                $metadata.Keywords = $kwColl
                try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40093}", ($Keywords -join ";")) } catch {}
            }

            $enc = [System.Windows.Media.Imaging.JpegBitmapEncoder]::new()
            $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame, $frame.Thumbnail, $metadata, $frame.ColorContexts))
            $outStream = [System.IO.File]::Create($tempMeta)
            $enc.Save($outStream)
            $inStream.Close()
            $outStream.Close()
            Move-Item -Path $tempMeta -Destination $FilePath -Force
        } catch {}
    }

    # -------------------------------------------------------------------------
    # Helper: Locate GDI+ JPEG Encoder Codec
    # -------------------------------------------------------------------------
    function Get-JpegCodec {
        [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" } |
            Select-Object -First 1
    }

    $jpegCodec = Get-JpegCodec
    if (-not $jpegCodec) {
        Write-Error "Could not find GDI+ JPEG encoder."
        return
    }

    # Configure JPEG compression quality parameter
    $encoder = [System.Drawing.Imaging.Encoder]::Quality
    $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($encoder, [long]$Quality)

    # Enumerate all image files in the target directory (excluding subfolders such as 'originals')
    $files = Get-ChildItem -Path $Folder -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } | Sort-Object Name

    if ($files.Count -eq 0) {
        Write-Host "No image files found in: $Folder" -ForegroundColor Yellow
        return
    }

    Write-Host "Scanning $($files.Count) image(s) in $Folder..." -ForegroundColor Cyan

    # Create optional backup directory if requested
    $backupDir = Join-Path $Folder "originals"
    if ($BackupOriginals -and -not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir | Out-Null
        Write-Host "Created backup folder: $backupDir" -ForegroundColor DarkGray
    }

    $resizedCount = 0
    $alreadyOptimizedCount = 0
    $totalSavedBytes = 0

    # =========================================================================
    # STEP 1: Process Image Sizes (16:9 Center-Crop & 1600x900 Resampling)
    # =========================================================================
    foreach ($file in $files) {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $origSize = $bytes.Length

        $ms = [System.IO.MemoryStream]::new($bytes)
        try {
            $srcImage = [System.Drawing.Image]::FromStream($ms)
        } catch {
            Write-Warning "Could not decode $($file.Name). Skipping resize."
            $ms.Dispose()
            continue
        }

        $origW = $srcImage.Width
        $origH = $srcImage.Height

        # If already 1600x900, skip resizing to avoid unnecessary re-compression
        if (-not $Force -and $origW -eq $TargetWidth -and $origH -eq $TargetHeight) {
            $alreadyOptimizedCount++
            $srcImage.Dispose()
            $ms.Dispose()
            continue
        }

        # Backup original file if switch is enabled
        if ($BackupOriginals) {
            $backupPath = Join-Path $backupDir $file.Name
            if (-not (Test-Path $backupPath)) {
                Copy-Item -Path $file.FullName -Destination $backupPath -Force
            }
        }

        # Extract comments and tags BEFORE resizing so they can be restored afterwards
        $origComment = Get-ImageComment $file.FullName
        $origTags = Get-ImageTags $file.FullName

        # Correct EXIF orientation tag (0x0112) so portrait/rotated camera shots are upright
        if ($srcImage.PropertyIdList -contains 0x0112) {
            try {
                $prop = $srcImage.GetPropertyItem(0x0112)
                $orientation = [System.BitConverter]::ToUInt16($prop.Value, 0)
                switch ($orientation) {
                    2 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
                    3 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
                    4 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
                    5 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
                    6 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
                    7 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
                    8 { $srcImage.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
                }
                $origW = $srcImage.Width
                $origH = $srcImage.Height
            } catch {}
        }

        # Calculate 16:9 center crop box
        $targetAspect = [double]$TargetWidth / [double]$TargetHeight
        $currentAspect = [double]$origW / [double]$origH

        if ($currentAspect -gt $targetAspect) {
            # Source image is wider than 16:9: crop left and right edges
            $cropHeight = $origH
            $cropWidth = [int][Math]::Round($origH * $targetAspect)
            $cropX = [int][Math]::Max(0, [Math]::Round(($origW - $cropWidth) / 2.0))
            $cropY = 0
        } else {
            # Source image is taller than 16:9: crop top and bottom edges
            $cropWidth = $origW
            $cropHeight = [int][Math]::Round($origW / $targetAspect)
            $cropX = 0
            $cropY = [int][Math]::Max(0, [Math]::Round(($origH - $cropHeight) / 2.0))
        }

        if ($cropX + $cropWidth -gt $origW) { $cropWidth = $origW - $cropX }
        if ($cropY + $cropHeight -gt $origH) { $cropHeight = $origH - $cropY }

        # Resample to 1600x900 with high-quality bicubic interpolation
        $destBmp = [System.Drawing.Bitmap]::new($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $destBmp.SetResolution(72, 72)
        $graphics = [System.Drawing.Graphics]::FromImage($destBmp)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $wrapMode = [System.Drawing.Drawing2D.WrapMode]::TileFlipXY
        $imageAttributes = [System.Drawing.Imaging.ImageAttributes]::new()
        $imageAttributes.SetWrapMode($wrapMode)

        $destRect = [System.Drawing.Rectangle]::new(0, 0, $TargetWidth, $TargetHeight)
        $graphics.DrawImage(
            $srcImage,
            $destRect,
            $cropX, $cropY, $cropWidth, $cropHeight,
            [System.Drawing.GraphicsUnit]::Pixel,
            $imageAttributes
        )

        $srcImage.Dispose()
        $ms.Dispose()
        $graphics.Dispose()
        $imageAttributes.Dispose()

        $tempFile = "$($file.FullName).tmp"
        $destBmp.Save($tempFile, $jpegCodec, $encoderParams)
        $destBmp.Dispose()

        # Restore comment and tag metadata onto newly optimized JPEG
        if ($origComment -or ($origTags -and $origTags.Raw.Count -gt 0)) {
            Set-JpegMetadata -FilePath $tempFile -Comment $origComment -Keywords $origTags.Raw
        }

        Move-Item -Path $tempFile -Destination $file.FullName -Force

        $newSize = (Get-Item $file.FullName).Length
        $savedBytes = $origSize - $newSize
        $totalSavedBytes += [Math]::Max(0, $savedBytes)
        $savedPct = if ($origSize -gt 0) { [Math]::Round(($savedBytes / $origSize) * 100, 1) } else { 0 }

        Write-Host "  [OPTIMIZED] $($file.Name): ${origW}x${origH} -> ${TargetWidth}x${TargetHeight} ($([Math]::Round($origSize/1KB)) KB -> $([Math]::Round($newSize/1KB)) KB, -$savedPct%)" -ForegroundColor Green
        $resizedCount++
    }

    # =========================================================================
    # STEP 2: Scan Metadata & Synchronize photos.json
    # =========================================================================
    Write-Host ""
    Write-Host "Checking photo metadata, comments, and tags..." -ForegroundColor Cyan

    $photosJsonPath = Join-Path $Folder "photos.json"
    $existingJsonRaw = ""
    if (Test-Path $photosJsonPath) {
        $existingJsonRaw = [System.IO.File]::ReadAllText($photosJsonPath)
    }

    $dict = [ordered]@{}

    foreach ($f in $files) {
        $comment = Get-ImageComment $f.FullName
        $tagInfo = Get-ImageTags $f.FullName

        # Collect primary hills:
        $primaries = [System.Collections.Generic.List[string]]::new($tagInfo.Primary)
        # 1. From filename (e.g. 196_001.jpg -> 196, 196a.jpg -> 196, 196.jpg -> 196)
        # CRC32 filenames (e.g. 4cd9e263.jpg) never contain a hill ID in the filename!
        $isCrc = $f.Name -match '^[a-fA-F0-9]{4,16}\.(?:jpg|jpeg|png|webp)$'
        if (-not $isCrc -and $f.BaseName -match '^(\d+)(?:_|[a-e]$|$)') {
            $fnHill = $Matches[1]
            if (-not $primaries.Contains($fnHill)) {
                $primaries.Add($fnHill)
            }
        }

        # Add Primary Hills
        foreach ($hid in $primaries) {
            if (-not $dict.Contains($hid)) {
                $dict[$hid] = [System.Collections.Generic.List[object]]::new()
            }
            $existing = $dict[$hid] | Where-Object { $_.file -eq $f.Name }
            if (-not $existing) {
                $dict[$hid].Add([ordered]@{
                    file = $f.Name
                    title = $comment
                    role = "primary"
                })
            }
        }

        # Add Secondary Hills
        foreach ($hid in $tagInfo.Secondary) {
            if ($primaries.Contains($hid)) { continue } # Primary takes precedence
            if (-not $dict.Contains($hid)) {
                $dict[$hid] = [System.Collections.Generic.List[object]]::new()
            }
            $existing = $dict[$hid] | Where-Object { $_.file -eq $f.Name }
            if (-not $existing) {
                $dict[$hid].Add([ordered]@{
                    file = $f.Name
                    title = $comment
                    role = "secondary"
                })
            }
        }

        # Add Taken From Hills
        foreach ($hid in $tagInfo.From) {
            if ($primaries.Contains($hid)) { continue } # Primary takes precedence
            if (-not $dict.Contains($hid)) {
                $dict[$hid] = [System.Collections.Generic.List[object]]::new()
            }
            $existing = $dict[$hid] | Where-Object { $_.file -eq $f.Name }
            if (-not $existing) {
                $dict[$hid].Add([ordered]@{
                    file = $f.Name
                    title = $comment
                    role = "from"
                })
            }
        }
    }

    # Sort hills numerically, and sort each hill's photos:
    # 1. Primary hills (role primary or direct match)
    # 2. Secondary background hills (role secondary)
    # 3. Taken from hills (role from)
    $sortedDict = [ordered]@{}
    $sortedKeys = $dict.Keys | Sort-Object { [int]$_ }
    foreach ($k in $sortedKeys) {
        $hillId = $k
        $photosForHill = $dict[$hillId]

        $sortedPhotos = @($photosForHill | Sort-Object {
            $item = $_
            $fileName = $item.file
            $role = if ($item.role) { $item.role.ToLower() } else { "primary" }
            $roleRank = switch ($role) {
                "primary"   { 0 }
                "secondary" { 1 }
                "from"      { 2 }
                default     { 3 }
            }
            $suffixIndex = 999999

            # Direct match check: filename starts with this hill's ID (legacy files only)
            $isCrc = $fileName -match '^[a-fA-F0-9]{4,16}\.'
            if (-not $isCrc -and $fileName -match "^$([regex]::Escape($hillId))(?:_(\d+)(?:_[a-fA-F0-9]+)?|[a-e])?\.") {
                $roleRank = 0
                if ($Matches[1]) {
                    $suffixIndex = [int]$Matches[1]
                } else {
                    $suffixIndex = 0
                }
            }
            # Natural composite sort key: role rank first, then numeric suffix, then filename
            return "$roleRank-$('000000' + $suffixIndex -replace '.*(.{6})$','$1')-$fileName"
        })

        $sortedDict[$hillId] = $sortedPhotos
    }

    $newJson = $sortedDict | ConvertTo-Json -Depth 5
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)

    # Compare existing JSON content against newly compiled state
    $needsJsonUpdate = $false
    if (-not (Test-Path $photosJsonPath) -or ($existingJsonRaw.Trim() -ne $newJson.Trim())) {
        $needsJsonUpdate = $true
    }

    # Only write to disk if changes were detected
    if ($needsJsonUpdate) {
        [System.IO.File]::WriteAllText($photosJsonPath, $newJson, $utf8NoBom)
        Write-Host "Updated $photosJsonPath with latest photos, comments, and tags." -ForegroundColor Green
    } else {
        Write-Host "photos.json is already up to date." -ForegroundColor DarkGray
    }

    # Print summary list of hills and associated photos
    foreach ($key in $sortedDict.Keys) {
        $info = $sortedDict[$key] | ForEach-Object {
            if ($_.title) { "$($_.file) [Title: '$($_.title)']" }
            else { "$($_.file) [No comment]" }
        }
        $joined = $info -join ', '
        Write-Host "  Hill #${key}: $joined" -ForegroundColor DarkGray
    }

    # Final summary statistics
    Write-Host ""
    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Total photos        : $($files.Count)"
    Write-Host "  Newly optimized     : $resizedCount"
    Write-Host "  Already 1600x900    : $alreadyOptimizedCount"
    if ($totalSavedBytes -gt 0) {
        Write-Host "  Disk space saved    : $([Math]::Round($totalSavedBytes / 1MB, 2)) MB" -ForegroundColor Green
    }
    if ($needsJsonUpdate) {
        Write-Host "  JSON status         : Updated" -ForegroundColor Green
    } else {
        Write-Host "  JSON status         : Up to date" -ForegroundColor DarkGray
    }
} catch {
    Write-Host ""
    Write-Host "An error occurred: $_" -ForegroundColor Red
} finally {
    # Keep console open so results can be reviewed
    Wait-Exit
}
