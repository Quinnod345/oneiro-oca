// tokens.swift
// Mac App Design System — Swift design token constants
// Generated for Oneiro Cognitive Architecture (OCA)

import Foundation
import SwiftUI

// MARK: - Spacing Scale

public enum Spacing {
    /// 4pt — micro gap, icon padding
    public static let xs: CGFloat = 4
    /// 8pt — compact inset, list row padding
    public static let sm: CGFloat = 8
    /// 12pt — standard inset, form field spacing
    public static let md: CGFloat = 12
    /// 20pt — section gap, card padding
    public static let lg: CGFloat = 20
    /// 32pt — layout region separation
    public static let xl: CGFloat = 32

    /// Returns the full scale as an ordered array
    public static let scale: [CGFloat] = [xs, sm, md, lg, xl]
}

// MARK: - Type Ramp with Optical Sizing

public enum Typography {
    public struct TypeStyle {
        public let size: CGFloat
        public let weight: Font.Weight
        public let lineHeight: CGFloat
        public let tracking: CGFloat
        public let opticalSize: CGFloat

        public var font: Font {
            Font.system(size: size, weight: weight, design: .default)
        }

        public var resolvedFont: Font {
            if #available(macOS 13.0, *) {
                return Font.system(size: size, weight: weight, design: .default)
                    .leading(.tight)
            }
            return font
        }
    }

    /// 11pt — captions, badge labels, timestamps
    public static let caption = TypeStyle(
        size: 11,
        weight: .regular,
        lineHeight: 16,
        tracking: 0.06,
        opticalSize: 11
    )

    /// 12pt — footnotes, secondary metadata
    public static let footnote = TypeStyle(
        size: 12,
        weight: .regular,
        lineHeight: 18,
        tracking: 0.04,
        opticalSize: 12
    )

    /// 13pt — body default for macOS
    public static let body = TypeStyle(
        size: 13,
        weight: .regular,
        lineHeight: 20,
        tracking: 0.0,
        opticalSize: 13
    )

    /// 14pt — callouts, emphasized body
    public static let callout = TypeStyle(
        size: 14,
        weight: .regular,
        lineHeight: 22,
        tracking: -0.01,
        opticalSize: 14
    )

    /// 15pt — subheadlines, sidebar section headers
    public static let subheadline = TypeStyle(
        size: 15,
        weight: .medium,
        lineHeight: 22,
        tracking: -0.02,
        opticalSize: 16
    )

    /// 17pt — headlines, modal titles
    public static let headline = TypeStyle(
        size: 17,
        weight: .semibold,
        lineHeight: 24,
        tracking: -0.04,
        opticalSize: 18
    )

    /// 20pt — titles, panel headers
    public static let title3 = TypeStyle(
        size: 20,
        weight: .semibold,
        lineHeight: 28,
        tracking: -0.06,
        opticalSize: 20
    )

    /// 22pt — window titles
    public static let title2 = TypeStyle(
        size: 22,
        weight: .bold,
        lineHeight: 30,
        tracking: -0.08,
        opticalSize: 22
    )

    /// 28pt — large titles, onboarding headers
    public static let title = TypeStyle(
        size: 28,
        weight: .bold,
        lineHeight: 36,
        tracking: -0.12,
        opticalSize: 28
    )

    /// 34pt — hero / splash text
    public static let largeTitle = TypeStyle(
        size: 34,
        weight: .heavy,
        lineHeight: 42,
        tracking: -0.16,
        opticalSize: 34
    )
}

// MARK: - Spring Animation Presets

public enum Springs {
    public struct SpringPreset {
        public let response: Double
        public let dampingFraction: Double
        public let blendDuration: Double

        @available(macOS 13.0, *)
        public var animation: Animation {
            .spring(response: response, dampingFraction: dampingFraction, blendDuration: blendDuration)
        }

        public var legacyAnimation: Animation {
            .spring(response: response, dampingFraction: dampingFraction, blendDuration: blendDuration)
        }
    }

    /// Snappy — fast, highly damped. Ideal for interactive controls, toggles, selection feedback.
    public static let snappy = SpringPreset(
        response: 0.28,
        dampingFraction: 0.82,
        blendDuration: 0.0
    )

    /// Gentle — slow, overdamped. Ideal for sidebars, content reveals, background transitions.
    public static let gentle = SpringPreset(
        response: 0.55,
        dampingFraction: 0.95,
        blendDuration: 0.08
    )

    /// Playful — bouncy, underdamped. Ideal for delight moments, icons, success states.
    public static let playful = SpringPreset(
        response: 0.42,
        dampingFraction: 0.58,
        blendDuration: 0.0
    )

    /// Instant — near-zero duration for state changes that should feel synchronous.
    public static let instant = SpringPreset(
        response: 0.12,
        dampingFraction: 1.0,
        blendDuration: 0.0
    )
}

// MARK: - Shadow Vocabulary

public struct ShadowStyle {
    public let color: Color
    public let radius: CGFloat
    public let x: CGFloat
    public let y: CGFloat
    public let opacity: Double
}

public enum Shadows {
    /// No shadow — flat, borderless surfaces
    public static let none = ShadowStyle(
        color: .black,
        radius: 0,
        x: 0,
        y: 0,
        opacity: 0
    )

    /// Micro — subtle depth for inline elements, chips
    public static let micro = ShadowStyle(
        color: .black,
        radius: 2,
        x: 0,
        y: 1,
        opacity: 0.08
    )

    /// Low — card resting state, list row hover
    public static let low = ShadowStyle(
        color: .black,
        radius: 4,
        x: 0,
        y: 2,
        opacity: 0.10
    )

    /// Medium — floating panels, popovers, dropdowns
    public static let medium = ShadowStyle(
        color: .black,
        radius: 12,
        x: 0,
        y: 6,
        opacity: 0.14
    )

    /// High — modal sheets, detached windows
    public static let high = ShadowStyle(
        color: .black,
        radius: 28,
        x: 0,
        y: 14,
        opacity: 0.18
    )

    /// Ambient — full-bleed glow for draggable windows
    public static let ambient = ShadowStyle(
        color: .black,
        radius: 48,
        x: 0,
        y: 24,
        opacity: 0.22
    )

    /// Focus ring — accessibility focus indicator
    public static let focusRing = ShadowStyle(
        color: Color.accentColor,
        radius: 4,
        x: 0,
        y: 0,
        opacity: 0.70
    )
}

// MARK: - Vibrancy Material Palette

public enum Materials {
    // MARK: Background Materials

    /// Ultra-thin translucency — sidebar chrome, toolbar underlay
    @available(macOS 12.0, *)
    public static let ultraThin = Material.ultraThinMaterial

    /// Thin translucency — secondary panels, split-view chrome
    @available(macOS 12.0, *)
    public static let thin = Material.thinMaterial

    /// Regular translucency — primary panel backgrounds
    @available(macOS 12.0, *)
    public static let regular = Material.regularMaterial

    /// Thick translucency — overlays, inspector panes
    @available(macOS 12.0, *)
    public static let thick = Material.thickMaterial

    /// Opaque chrome — backgrounds that must be fully opaque
    @available(macOS 12.0, *)
    public static let ultraThick = Material.ultraThickMaterial

    // MARK: Semantic Vibrancy Tints

    public struct VibrancyToken {
        public let light: Color
        public let dark: Color

        public var adaptive: Color {
            Color(nsColor: NSColor(name: nil, dynamicProvider: { appearance in
                appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                    ? NSColor(dark)
                    : NSColor(light)
            }) ?? NSColor.labelColor)
        }
    }

    /// Primary label on vibrancy
    public static let labelPrimary = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.85),
        dark:  Color(white: 1.0, opacity: 0.85)
    )

    /// Secondary label on vibrancy
    public static let labelSecondary = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.50),
        dark:  Color(white: 1.0, opacity: 0.50)
    )

    /// Tertiary label on vibrancy
    public static let labelTertiary = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.25),
        dark:  Color(white: 1.0, opacity: 0.25)
    )

    /// Separator line on vibrancy
    public static let separator = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.12),
        dark:  Color(white: 1.0, opacity: 0.12)
    )

    /// Fill — interactive element background on vibrancy
    public static let fillPrimary = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.06),
        dark:  Color(white: 1.0, opacity: 0.08)
    )

    /// Fill secondary — hover / pressed state on vibrancy
    public static let fillSecondary = VibrancyToken(
        light: Color(white: 0.0, opacity: 0.10),
        dark:  Color(white: 1.0, opacity: 0.12)
    )

    // MARK: Accent Vibrancy

    /// Accent overlay on vibrancy (uses system accent)
    public static let accentFill = Color.accentColor.opacity(0.18)
    public static let accentLabel = Color.accentColor.opacity(0.88)

    // MARK: Semantic Surface Colors

    /// Sidebar background
    public static let surfaceSidebar     = Color(nsColor: .windowBackgroundColor).opacity(0.72)
    /// Content area background
    public static let surfaceContent     = Color(nsColor: .controlBackgroundColor)
    /// Popover / floating surface
    public static let surfaceFloating    = Color(nsColor: .windowBackgroundColor).opacity(0.88)
    /// Destructive tint surface
    public static let surfaceDestructive = Color.red.opacity(0.10)
    /// Success tint surface
    public static let surfaceSuccess     = Color.green.opacity(0.10)
    /// Warning tint surface
    public static let surfaceWarning     = Color.orange.opacity(0.10)
}

// MARK: - Corner Radius Scale

public enum CornerRadius {
    public static let xs:  CGFloat = 4
    public static let sm:  CGFloat = 6
    public static let md:  CGFloat = 8
    public static let lg:  CGFloat = 12
    public static let xl:  CGFloat = 16
    public static let xxl: CGFloat = 20
    /// Continuous / squircle radius for app-icon-shaped surfaces
    public static let icon: CGFloat = 22
}

// MARK: - Z-Index / Layer Order

public enum ZLayer {
    public static let base:    Int = 0
    public static let raised:  Int = 10
    public static let overlay: Int = 20
    public static let modal:   Int = 30
    public static let toast:   Int = 40
    public static let system:  Int = 50
}

// MARK: - Convenience View Extensions

public extension View {
    func shadowStyle(_ style: ShadowStyle) -> some View {
        self.shadow(
            color: style.color.opacity(style.opacity),
            radius: style.radius,
            x: style.x,
            y: style.y
        )
    }

    @available(macOS 12.0, *)
    func vibrancyBackground(_ material: Material, cornerRadius: CGFloat = CornerRadius.md) -> some View {
        self.background(material, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}