package httpapi

import (
	"context"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// UserRegistrar, POST /v1/auth/register.
type UserRegistrar interface {
	Register(ctx context.Context, input auth.RegisterInput, meta auth.RequestMeta) (auth.Grant, error)
}

// UserAuthenticator, POST /v1/auth/login.
type UserAuthenticator interface {
	Login(ctx context.Context, input auth.LoginInput, meta auth.RequestMeta) (auth.Grant, error)
}

// PasswordResetter, POST /v1/auth/password-reset (demo sifre yenileme, T11.9).
type PasswordResetter interface {
	ResetPassword(ctx context.Context, input auth.ResetPasswordInput, meta auth.RequestMeta) (auth.Grant, error)
}

// PhoneChecker, POST /v1/auth/phone-check (T11.7).
type PhoneChecker interface {
	PhoneRegistered(ctx context.Context, input auth.PhoneCheckInput) (bool, error)
}

// SessionRefresher, POST /v1/auth/refresh.
type SessionRefresher interface {
	Refresh(ctx context.Context, refreshToken string) (auth.Grant, error)
}

// SessionRevoker, POST /v1/auth/logout.
type SessionRevoker interface {
	Logout(ctx context.Context, refreshToken string) (bool, error)
}

// AccessTokenVerifier, korumali uclarin erisim jetonunu dogrular (identity.go);
// gercegi auth.Tokens.
type AccessTokenVerifier interface {
	Verify(token string) (auth.Identity, error)
}
