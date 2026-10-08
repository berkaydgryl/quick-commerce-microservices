package testkit

import (
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// SetTrailer, sahte gRPC istemcisinde cagrinin trailer'ini doldurur: gercek
// istemci gibi grpc.Trailer secenegine (rpc.Invoke verir) yazar. Servisin is
// hatasi (x-app-error) boyle tasinir. trailer nil ise dokunmaz.
func SetTrailer(opts []grpc.CallOption, trailer metadata.MD) {
	if trailer == nil {
		return
	}
	for _, option := range opts {
		if target, isTrailer := option.(grpc.TrailerCallOption); isTrailer {
			*target.TrailerAddr = trailer
		}
	}
}
