FROM golang:alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -o chaincode

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/chaincode .
EXPOSE 9999
CMD ["./chaincode"]
