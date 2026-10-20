<#
.SYNOPSIS
    Worker script to crop, resample, apply Windows EXIF metadata, and register hill photos.
.DESCRIPTION
    Invoked by the backend API to process an individual staging photo:
    - Rotates image upright (EXIF orientation)
    - Crops the selected 16:9 bounding box
    - Resamples to 1600x900 (HighQualityBicubic, 85% JPEG quality)
    - Writes Windows Explorer Comments (XPComment) and Tags (XPKeywords)
    - Saves to image/hills/<TargetFileName>
    - Updates photos.json manifest
    - Deletes staging file if requested
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$StagingFile,

    [string]$HillId = "",

    [Parameter(Mandatory=$true)]
    [string]$TargetFileName,

    [string]$PrimaryHills = "",
    [string]$SecondaryHills = "",
    [string]$FromHills = "",

    [int]$CropX = 0,
    [int]$CropY = 0,
    [int]$CropWidth = 0,
    [int]$CropHeight = 0,

    [string]$Comment = "",
    [string]$Keywords = "",

    [string]$ArchiveFolder = "",
    [string]$HillsDir = "",

    [string]$CroppedFile = "",

    [int]$Quality = 85,
    [int]$TargetWidth = 1600,
    [int]$TargetHeight = 900,

    [switch]$DeleteStaging
)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName WindowsBase

    if (-not (Test-Path $StagingFile)) {
        throw "Staging file not found: $StagingFile"
    }

    if (-not $HillsDir) {
        $candidate = Join-Path $PSScriptRoot "..\..\image\hills"
        if (Test-Path $candidate) {
            $HillsDir = (Resolve-Path $candidate).Path
        } else {
            $HillsDir = $PSScriptRoot
        }
    }
    $hillsDir = (Resolve-Path $HillsDir).Path
    $targetPath = Join-Path $hillsDir $TargetFileName

    $tempFile = Join-Path $hillsDir "temp_$TargetFileName"

    if ($CroppedFile -and (Test-Path $CroppedFile)) {
        # Browser already rendered cropped, rotated, and filtered 1600x900 image
        if ($CroppedFile -ne $tempFile) {
            Copy-Item -Path $CroppedFile -Destination $tempFile -Force
        }
    } else {
        # Read original file bytes to prevent file locking issues
        $bytes = [System.IO.File]::ReadAllBytes($StagingFile)
        $ms = [System.IO.MemoryStream]::new($bytes)
        $srcImage = [System.Drawing.Image]::FromStream($ms)

        # Correct EXIF orientation tag (0x0112) so portrait/camera angles are upright
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
            } catch {}
        }

        $origW = $srcImage.Width
        $origH = $srcImage.Height

        # If crop box is invalid or not specified, calculate standard 16:9 center crop
        $targetAspect = [double]$TargetWidth / [double]$TargetHeight
        if ($CropWidth -le 0 -or $CropHeight -le 0) {
            $currentAspect = [double]$origW / [double]$origH
            if ($currentAspect -gt $targetAspect) {
                $CropHeight = $origH
                $CropWidth = [int][Math]::Round($origH * $targetAspect)
                $CropX = [int][Math]::Max(0, [Math]::Round(($origW - $CropWidth) / 2.0))
                $CropY = 0
            } else {
                $CropWidth = $origW
                $CropHeight = [int][Math]::Round($origW / $targetAspect)
                $CropX = 0
                $CropY = [int][Math]::Max(0, [Math]::Round(($origH - $CropHeight) / 2.0))
            }
        }

        # Clamp crop parameters within image bounds
        $CropX = [Math]::Max(0, [Math]::Min($CropX, $origW - 1))
        $CropY = [Math]::Max(0, [Math]::Min($CropY, $origH - 1))
        $CropWidth = [Math]::Max(10, [Math]::Min($CropWidth, $origW - $CropX))
        $CropHeight = [Math]::Max(10, [Math]::Min($CropHeight, $origH - $CropY))

        # Resample to TargetWidth x TargetHeight (1600 x 900)
        $destBmp = [System.Drawing.Bitmap]::new($TargetWidth, $TargetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $destBmp.SetResolution(72, 72)
        $g = [System.Drawing.Graphics]::FromImage($destBmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

        $srcRect = [System.Drawing.Rectangle]::new($CropX, $CropY, $CropWidth, $CropHeight)
        $destRect = [System.Drawing.Rectangle]::new(0, 0, $TargetWidth, $TargetHeight)
        $g.DrawImage($srcImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

        $g.Dispose()
        $srcImage.Dispose()
        $ms.Dispose()

        # Find JPEG Codec & configure compression quality
        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1

        $encoder = [System.Drawing.Imaging.Encoder]::Quality
        $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
        $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($encoder, [long]$Quality)

        # Save initial cropped JPEG to temporary file
        $destBmp.Save($tempFile, $jpegCodec, $encoderParams)
        $destBmp.Dispose()
    }

    # Parse Keywords array for tags
    $keywordList = [System.Collections.Generic.List[string]]::new()
    if ($Keywords) {
        $splitKw = $Keywords -split '[,;]+' | Where-Object { $_.Trim() }
        foreach ($kw in $splitKw) {
            $t = $kw.Trim()
            if ($t -and -not $keywordList.Contains($t)) {
                $keywordList.Add($t)
            }
        }
    }

    # Extract distinct hill lists by role
    $primaryList = [System.Collections.Generic.List[string]]::new()
    $secondaryList = [System.Collections.Generic.List[string]]::new()
    $fromList = [System.Collections.Generic.List[string]]::new()

    # From explicit parameters
    if ($PrimaryHills) {
        foreach ($h in ($PrimaryHills -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
            if (-not $primaryList.Contains($h)) { $primaryList.Add($h) }
        }
    }
    if ($SecondaryHills) {
        foreach ($h in ($SecondaryHills -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
            if (-not $secondaryList.Contains($h)) { $secondaryList.Add($h) }
        }
    }
    if ($FromHills) {
        foreach ($h in ($FromHills -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
            if (-not $fromList.Contains($h)) { $fromList.Add($h) }
        }
    }

    # Also parse from Keywords if tags contain primary:196|209, secondary:74, from:79
    foreach ($kw in $keywordList) {
        if ($kw -match '^primary:(.+)$') {
            foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                if (-not $primaryList.Contains($h)) { $primaryList.Add($h) }
            }
        } elseif ($kw -match '^secondary:(.+)$') {
            foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                if (-not $secondaryList.Contains($h)) { $secondaryList.Add($h) }
            }
        } elseif ($kw -match '^from:(.+)$') {
            foreach ($h in ($Matches[1] -split '[,|;\s]+' | Where-Object { $_ -match '^\d+$' })) {
                if (-not $fromList.Contains($h)) { $fromList.Add($h) }
            }
        } elseif ($kw -match '^\d+$') {
            if (-not $primaryList.Contains($kw) -and -not $secondaryList.Contains($kw)) {
                $secondaryList.Add($kw)
            }
        }
    }

    # Legacy fallback: HillId defaults to primary
    if ($HillId -and $primaryList.Count -eq 0 -and $fromList.Count -eq 0) {
        if (-not $primaryList.Contains($HillId)) {
            $primaryList.Add($HillId)
        }
    }

    # Ensure formatted tags exist in keywordList for Windows Explorer EXIF metadata
    if ($primaryList.Count -gt 0 -and (-not ($keywordList | Where-Object { $_ -like "primary:*" }))) {
        $keywordList.Add("primary:" + ($primaryList -join "|"))
    }
    if ($secondaryList.Count -gt 0 -and (-not ($keywordList | Where-Object { $_ -like "secondary:*" }))) {
        $keywordList.Add("secondary:" + ($secondaryList -join "|"))
    }
    if ($fromList.Count -gt 0 -and (-not ($keywordList | Where-Object { $_ -like "from:*" }))) {
        $keywordList.Add("from:" + ($fromList -join "|"))
    }

    # Write Windows Explorer Comments (XPComment) and Tags (XPKeywords) via WPF
    try {
        $tempMeta = "$targetPath.meta.tmp"
        $inStream = [System.IO.File]::OpenRead($tempFile)
        $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($inStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
        $frame = $decoder.Frames[0]
        $metadata = $frame.Metadata.Clone() -as [System.Windows.Media.Imaging.BitmapMetadata]
        if (-not $metadata) { $metadata = [System.Windows.Media.Imaging.BitmapMetadata]::new("jpg") }

        if ($Comment) {
            $metadata.Comment = $Comment
            $metadata.Title = $Comment
            try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40092}", $Comment) } catch {}
            try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40091}", $Comment) } catch {}
        }
        if ($keywordList.Count -gt 0) {
            $kwColl = [System.Collections.ObjectModel.ReadOnlyCollection[string]]::new($keywordList)
            $metadata.Keywords = $kwColl
            try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40093}", ($keywordList -join ";")) } catch {}
            try { $metadata.SetQuery("/app1/ifd/exif/{ushort=40094}", ($keywordList -join ";")) } catch {}
        }

        $enc = [System.Windows.Media.Imaging.JpegBitmapEncoder]::new()
        $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame, $frame.Thumbnail, $metadata, $frame.ColorContexts))
        $outStream = [System.IO.File]::Create($tempMeta)
        $enc.Save($outStream)
        $inStream.Close()
        $outStream.Close()

        if (Test-Path $tempFile) { Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue }
        Move-Item -Path $tempMeta -Destination $targetPath -Force
    } catch {
        # Fallback: if WPF metadata write encounters an issue, promote tempFile directly
        if (Test-Path $tempFile) {
            Move-Item -Path $tempFile -Destination $targetPath -Force
        }
    }

    # Update photos.json manifest
    $photosJsonPath = Join-Path $hillsDir "photos.json"
    $dict = [ordered]@{}
    if (Test-Path $photosJsonPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($photosJsonPath)
            if ($raw.Trim()) {
                $parsed = $raw | ConvertFrom-Json
                foreach ($prop in $parsed.PSObject.Properties) {
                    $list = [System.Collections.Generic.List[object]]::new()
                    foreach ($entry in $prop.Value) {
                        $list.Add([ordered]@{
                            file = $entry.file
                            title = $entry.title
                            role = if ($entry.role) { $entry.role } else { "primary" }
                        })
                    }
                    $dict[$prop.Name] = $list
                }
            }
        } catch {}
    }

    # Remove any previous entries for this TargetFileName across all hills before re-adding
    foreach ($k in @($dict.Keys)) {
        $filtered = @($dict[$k] | Where-Object { $_.file -ne $TargetFileName })
        if ($filtered.Count -eq 0) {
            $dict.Remove($k)
        } else {
            $newList = [System.Collections.Generic.List[object]]::new()
            foreach ($item in $filtered) { $newList.Add($item) }
            $dict[$k] = $newList
        }
    }

    # Add Primary Hills
    foreach ($hid in $primaryList) {
        if (-not $dict.Contains($hid)) {
            $dict[$hid] = [System.Collections.Generic.List[object]]::new()
        }
        $dict[$hid].Add([ordered]@{
            file = $TargetFileName
            title = $Comment
            role = "primary"
        })
    }

    # Add Secondary Hills
    foreach ($hid in $secondaryList) {
        if (-not $dict.Contains($hid)) {
            $dict[$hid] = [System.Collections.Generic.List[object]]::new()
        }
        $dict[$hid].Add([ordered]@{
            file = $TargetFileName
            title = $Comment
            role = "secondary"
        })
    }

    # Add Taken From Hills
    foreach ($hid in $fromList) {
        if (-not $dict.Contains($hid)) {
            $dict[$hid] = [System.Collections.Generic.List[object]]::new()
        }
        $dict[$hid].Add([ordered]@{
            file = $TargetFileName
            title = $Comment
            role = "from"
        })
    }

    # Sort manifest entries cleanly:
    # 0: Primary
    # 1: Secondary
    # 2: From
    # 3: Other
    $sortedDict = [ordered]@{}
    $sortedKeys = $dict.Keys | Sort-Object { [int]$_ }
    foreach ($k in $sortedKeys) {
        $photosForHill = $dict[$k]
        $sortedPhotos = @($photosForHill | Sort-Object -Property @{ Expression = {
            $fn = $_.file
            $role = $_.role
            $prio = 3
            $isCrc = $fn -match '^[a-fA-F0-9]{4,16}\.'
            if ($role -eq 'primary') { $prio = 0 }
            elseif ($role -eq 'secondary') { $prio = 1 }
            elseif ($role -eq 'from') { $prio = 2 }
            elseif (-not $isCrc -and $fn -match "^$([regex]::Escape($k))(?:_(\d+)(?:_[a-fA-F0-9]+)?|[a-e])?\.") {
                $prio = 0
            }
            return "$prio-$fn"
        }})
        $sortedDict[$k] = $sortedPhotos
    }

    $newJson = $sortedDict | ConvertTo-Json -Depth 5
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($photosJsonPath, $newJson, $utf8NoBom)

    # Archive original staging file if requested, or delete if -DeleteStaging
    if ($ArchiveFolder -and (Test-Path $StagingFile)) {
        if (-not (Test-Path $ArchiveFolder)) {
            New-Item -ItemType Directory -Path $ArchiveFolder -Force | Out-Null
        }
        $destArchive = Join-Path $ArchiveFolder (Split-Path -Leaf $StagingFile)
        Move-Item -Path $StagingFile -Destination $destArchive -Force
    } elseif ($DeleteStaging -and (Test-Path $StagingFile)) {
        Remove-Item -Path $StagingFile -Force -ErrorAction SilentlyContinue
    }

    $result = @{
        success = $true
        savedFile = $TargetFileName
        primary = $primaryList
        secondary = $secondaryList
        from = $fromList
        comment = $Comment
        tags = $keywordList
    }
    Write-Output ($result | ConvertTo-Json -Compress)
} catch {
    $errResult = @{
        success = $false
        error = $_.Exception.Message
    }
    Write-Output ($errResult | ConvertTo-Json -Compress)
    exit 1
}
